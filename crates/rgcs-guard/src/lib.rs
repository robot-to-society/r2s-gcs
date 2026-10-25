//! Portable AI-guard detectors (spec `2026-10-24-ai-intervention-design.md` §7.1).
//!
//! Everything here is pure: no I/O, no async, no clocks (`std::time` is never read), no
//! logging and no server types. The only dependency is `serde`, so the same crate can run in
//! `rgcs-server` today and on a future onboard node or flight controller with a local LLM.
//! Time comes in through [`Sample::t_ms`]; state is returned as new values, never mutated in
//! place behind the caller's back.
#![forbid(unsafe_code)]

pub mod geo;
pub mod sample;
pub mod sensitivity;
mod signs;
pub mod toilet_bowl;

pub use sample::{monitored, recommended_mode, Airframe, Sample};
pub use sensitivity::{effective, ExtLevel, ExternalContext};
pub use toilet_bowl::{apply_hold, evaluate, Signs, TbState, ToiletBowlConfig, ToiletBowlDetector, Verdict};
