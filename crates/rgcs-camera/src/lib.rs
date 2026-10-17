//! Camera / gimbal drivers (spec 40). `siyi` is the MT11 protocol ported from the Python app;
//! the `Camera` trait is what the server talks to.

pub mod camera;
pub mod error;
pub mod none;
pub mod siyi;

pub use camera::Camera;
pub use error::CameraError;
pub use none::NoneCamera;
pub use siyi::client::SiyiMt11;
