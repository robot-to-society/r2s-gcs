//! SIYI SDK protocol (spec 40 §3): frame codec, command encoders, reply parsers.

pub mod ai;
pub mod client;
pub mod encode;
pub mod frame;
pub mod parse;
pub mod tf_card;
pub mod thermal;
#[cfg(any(test, feature = "sim"))]
pub mod sim;
#[cfg(any(test, feature = "sim"))]
pub mod sim_media;
