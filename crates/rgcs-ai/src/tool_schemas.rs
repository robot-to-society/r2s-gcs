//! JSON schemas and descriptions of the assistant's tools, sent to the LLM as-is.

use serde_json::{json, Value};

use crate::tools::{PROPOSABLE_COMMANDS, TOOL_NAMES};

/// One tool as the LLM sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub schema: Value,
}

fn sysid_schema(what: &str) -> Value {
    json!({"type": "integer", "minimum": 1, "maximum": 255, "description": what})
}

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type": "object", "properties": properties, "required": required})
}

fn command_schema() -> Value {
    json!({
        "type": "object",
        "description": "Vehicle command. Arguments: set_mode {mode: ArduPilot mode name for the \
            airframe, e.g. LOITER}; change_speed {mps: 0.5-40}; takeoff {alt_rel: metres above \
            home, 1-1000}. The other commands take no args.",
        "properties": {
            "cmd": {"type": "string", "enum": PROPOSABLE_COMMANDS},
            "args": {"type": "object"}
        },
        "required": ["cmd"]
    })
}

fn spec(name: &'static str, description: &'static str, schema: Value) -> ToolSpec {
    ToolSpec {
        name,
        description,
        schema,
    }
}

/// The five tools, in [`TOOL_NAMES`] order.
pub fn tool_specs() -> Vec<ToolSpec> {
    let [status, list, recent, search, propose] = TOOL_NAMES;
    vec![
        spec(
            status,
            "Current state of one vehicle: link, armed, mode, position, altitude, speed, battery, \
             GPS, last receive time and the video state. Text from the vehicle is under \
             untrusted_text.",
            object(json!({"sysid": sysid_schema("Vehicle system id")}), &["sysid"]),
        ),
        spec(
            list,
            "All known vehicles with sysid, name, airframe, link and mode.",
            object(json!({}), &[]),
        ),
        spec(
            recent,
            "Newest messages (STATUSTEXT, system messages, command results), newest first. \
             Message text is under untrusted_text.",
            object(
                json!({
                    "sysid": sysid_schema("Only this vehicle; omit for all"),
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20}
                }),
                &[],
            ),
        ),
        spec(
            search,
            "Case-insensitive substring search over the stored message log (STATUSTEXT, system \
             messages, command results; the newest 5000 rows). It does not search DataFlash \
             (.bin) or telemetry logs. At most 30 hits.",
            object(
                json!({
                    "query": {"type": "string", "minLength": 1, "maxLength": 100},
                    "sysid": sysid_schema("Only this vehicle; omit for all"),
                    "since": {"type": "integer", "description": "Only messages at or after this unix time in milliseconds"}
                }),
                &["query"],
            ),
        ),
        spec(
            propose,
            "Propose a vehicle command to the operator. Nothing is sent: the operator sees a card \
             and decides whether to execute it. Use only for what the operator asked for, and give \
             a short reason.",
            object(
                json!({
                    "sysid": sysid_schema("Target vehicle system id"),
                    "command": command_schema(),
                    "reason": {"type": "string", "minLength": 1, "maxLength": 500}
                }),
                &["sysid", "command", "reason"],
            ),
        ),
    ]
}
