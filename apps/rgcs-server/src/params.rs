//! Per-vehicle parameter cache fed by PARAM_VALUE events (P1: fence check; P4: full table).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use rgcs_core::SysId;
use rgcs_mavlink::RouterEvent;

/// Shared, cheap to clone. The map is mutated in place under its mutex: a full parameter
/// download is ~1,000 entries and copying it per PARAM_VALUE would be quadratic.
#[derive(Clone, Default)]
pub struct ParamStore {
    inner: Arc<Mutex<HashMap<(SysId, String), f32>>>,
}

impl ParamStore {
    pub fn get(&self, sysid: SysId, name: &str) -> Option<f32> {
        self.inner
            .lock()
            .expect("param store mutex")
            .get(&(sysid, name.to_string()))
            .copied()
    }

    pub fn set(&self, sysid: SysId, name: &str, value: f32) {
        self.inner
            .lock()
            .expect("param store mutex")
            .insert((sysid, name.to_string()), value);
    }

    /// Records `ParamValue` events; everything else is ignored.
    pub fn apply(&self, ev: &RouterEvent) {
        if let RouterEvent::ParamValue {
            sysid, name, value, ..
        } = ev
        {
            self.set(*sysid, name, *value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_get_and_missing() {
        let p = ParamStore::default();
        assert_eq!(p.get(1, "FENCE_ALT_MAX"), None);
        p.set(1, "FENCE_ALT_MAX", 120.0);
        assert_eq!(p.get(1, "FENCE_ALT_MAX"), Some(120.0));
        assert_eq!(p.get(2, "FENCE_ALT_MAX"), None);
    }

    #[test]
    fn apply_records_param_value_events_only() {
        let p = ParamStore::default();
        p.apply(&RouterEvent::Updated(1));
        p.apply(&RouterEvent::ParamValue {
            sysid: 1,
            name: "FENCE_ENABLE".into(),
            value: 1.0,
            index: 0,
            count: 1,
        });
        assert_eq!(p.get(1, "FENCE_ENABLE"), Some(1.0));
    }
}
