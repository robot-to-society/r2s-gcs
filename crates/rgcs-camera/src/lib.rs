//! Camera / gimbal drivers (spec 40). `siyi` is the MT11 protocol ported from the Python app;
//! the `Camera` trait is what the server talks to.

pub mod error;
pub mod siyi;

pub use error::CameraError;
