//! MAVLink camera / gimbal driver (spec 40 §2 `mavlink_cam`). Pure protocol modules:
//! `binding` picks "our" camera and gimbal manager, `caps` turns them into `CameraCaps`,
//! `attitude` converts the gimbal quaternion, `encode` builds the outgoing frames and
//! `apply` folds received frames into a `Model`.

pub mod apply;
pub mod attitude;
pub mod binding;
pub mod caps;
pub mod encode;
pub mod driver;
mod motion;
#[cfg(any(test, feature = "sim"))]
pub mod fake;
pub mod requests;
