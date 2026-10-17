//! Joins chunked STATUSTEXT. ArduPilot splits long texts into 50-byte chunks; this dialect
//! build exposes no `id` / `chunk_seq`, so a chunk that fills all 50 bytes means "more
//! follows" and a shorter one ends the message. Stale partials flush after 1 s.

use rgcs_core::SysId;

pub const CHUNK_LEN: usize = 50;
pub const FLUSH_AFTER_MS: u64 = 1_000;
/// A joined message never exceeds this many chunks; the cap emits it (bounded memory).
pub const MAX_CHUNKS: usize = 32;

/// A chunk that uses every byte of the 50-byte wire field means "more follows".
pub fn is_full_chunk(wire: &[u8]) -> bool {
    wire.len() >= CHUNK_LEN && wire[..CHUNK_LEN].iter().all(|b| *b != 0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Complete {
    pub sysid: SysId,
    pub severity: u8,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Partial {
    sysid: SysId,
    severity: u8,
    text: String,
    started_ms: u64,
}

/// Immutable joiner: every call returns the next state.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Joiner {
    partials: Vec<Partial>,
}

impl Joiner {
    /// `raw` is the chunk's text with trailing NULs removed; `full` is whether the wire chunk
    /// used all 50 bytes.
    pub fn push(
        &self,
        sysid: SysId,
        severity: u8,
        raw: &str,
        full: bool,
        now_ms: u64,
    ) -> (Self, Option<Complete>) {
        let (kept, prev): (Vec<Partial>, Vec<Partial>) =
            self.partials.iter().cloned().partition(|p| p.sysid != sysid);
        // `started_ms` stays at the first chunk so appends never postpone the flush.
        let (text, started_ms) = match prev.into_iter().next() {
            Some(p) => (p.text + raw, p.started_ms),
            None => (raw.to_string(), now_ms),
        };
        if full && text.len() < MAX_CHUNKS * CHUNK_LEN {
            let mut partials = kept;
            partials.push(Partial {
                sysid,
                severity,
                text,
                started_ms,
            });
            return (Self { partials }, None);
        }
        (
            Self { partials: kept },
            Some(Complete {
                sysid,
                severity,
                text,
            }),
        )
    }

    /// Emits partials older than [`FLUSH_AFTER_MS`] as-is (the tail never came).
    pub fn flush(&self, now_ms: u64) -> (Self, Vec<Complete>) {
        let (stale, fresh): (Vec<Partial>, Vec<Partial>) = self
            .partials
            .iter()
            .cloned()
            .partition(|p| now_ms.saturating_sub(p.started_ms) >= FLUSH_AFTER_MS);
        let done = stale
            .into_iter()
            .map(|p| Complete {
                sysid: p.sysid,
                severity: p.severity,
                text: p.text,
            })
            .collect();
        (Self { partials: fresh }, done)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_chunk_completes_immediately() {
        let (j, out) = Joiner::default().push(1, 4, "PreArm: Compass not calibrated", false, 0);
        assert_eq!(j, Joiner::default());
        assert_eq!(
            out,
            Some(Complete {
                sysid: 1,
                severity: 4,
                text: "PreArm: Compass not calibrated".into()
            })
        );
    }

    #[test]
    fn full_chunk_waits_for_the_tail_and_joins_in_order() {
        let head = "A".repeat(CHUNK_LEN);
        let (j, out) = Joiner::default().push(1, 6, &head, true, 0);
        assert_eq!(out, None);
        let (j2, out) = j.push(1, 6, " tail", false, 10);
        assert_eq!(out.unwrap().text, format!("{head} tail"));
        assert_eq!(j2, Joiner::default());
        assert_eq!(j.partials.len(), 1, "push does not mutate the previous value");
    }

    #[test]
    fn partials_are_per_vehicle() {
        let head = "B".repeat(CHUNK_LEN);
        let (j, _) = Joiner::default().push(1, 6, &head, true, 0);
        let (j, out) = j.push(2, 6, "other vehicle", false, 5);
        assert_eq!(out.unwrap().sysid, 2);
        let (_, out) = j.push(1, 6, " end", false, 6);
        assert_eq!(out.unwrap().text, format!("{head} end"));
    }

    #[test]
    fn a_stream_of_full_chunks_cannot_grow_forever() {
        let chunk = "E".repeat(CHUNK_LEN);
        let mut j = Joiner::default();
        let mut completed = None;
        for i in 0..MAX_CHUNKS + 5 {
            let (next, out) = j.push(1, 6, &chunk, true, i as u64 * 10);
            j = next;
            if let Some(c) = out {
                completed = Some((i, c));
                break;
            }
        }
        let (at, c) = completed.expect("the cap emits the message");
        assert_eq!(at + 1, MAX_CHUNKS);
        assert_eq!(c.text.len(), MAX_CHUNKS * CHUNK_LEN);
        assert_eq!(j, Joiner::default());
    }

    #[test]
    fn started_ms_is_the_first_chunk_so_appends_do_not_postpone_the_flush() {
        let chunk = "F".repeat(CHUNK_LEN);
        let (j, _) = Joiner::default().push(1, 6, &chunk, true, 0);
        let (j, _) = j.push(1, 6, &chunk, true, 900);
        let (_, out) = j.flush(1_000);
        assert_eq!(out.len(), 1);
    }

    #[test]
    fn fullness_is_decided_on_the_wire_bytes() {
        assert!(is_full_chunk(&[b'A'; CHUNK_LEN]));
        let mut padded = [b'A'; CHUNK_LEN];
        padded[CHUNK_LEN - 1] = 0;
        assert!(!is_full_chunk(&padded));
        assert!(!is_full_chunk(&[b'A'; 10]));
    }

    #[test]
    fn stale_partial_is_flushed_after_one_second() {
        let head = "C".repeat(CHUNK_LEN);
        let (j, _) = Joiner::default().push(1, 6, &head, true, 0);
        let (j, out) = j.flush(999);
        assert!(out.is_empty());
        let (j, out) = j.flush(1_000);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].text, head);
        assert_eq!(j, Joiner::default());
    }
}
