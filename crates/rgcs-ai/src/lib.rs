//! RGCS AI assistant (spec 30 §2): config, tool definitions and the system prompt.
//! Knows nothing about axum or the server state; the server implements the tool host.

pub mod config;
pub mod prompt;
mod tool_schemas;
pub mod tools;

pub use config::{AiConfig, Limits, ProviderKind, ResolvedAi, Secret, Unconfigured, MAX_TOOL_ITERATIONS};
pub use prompt::SYSTEM_PROMPT_JA;
pub use tools::{parse_call, tool_specs, ToolCall, ToolError, ToolSpec, PROPOSABLE_COMMANDS, TOOL_NAMES};
