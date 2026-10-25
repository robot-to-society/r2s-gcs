//! Token metering for AI chat turns, and the provider-error replies sent to the client.

use std::sync::atomic::{AtomicU64, Ordering};

use async_trait::async_trait;
use axum::http::StatusCode;
use rgcs_ai::{AiError, LlmClient, LlmRequest, LlmResponse};

/// Wraps the LLM client and adds up the tokens of every answered call, so a turn that later
/// fails or times out can still be charged to the budget.
pub struct Metered<'a> {
    inner: &'a dyn LlmClient,
    used: AtomicU64,
}

impl<'a> Metered<'a> {
    pub fn new(inner: &'a dyn LlmClient) -> Self {
        Self {
            inner,
            used: AtomicU64::new(0),
        }
    }

    pub fn used(&self) -> u64 {
        self.used.load(Ordering::Relaxed)
    }
}

#[async_trait]
impl LlmClient for Metered<'_> {
    async fn complete(&self, req: LlmRequest<'_>) -> Result<LlmResponse, AiError> {
        let resp = self.inner.complete(req).await?;
        self.used.fetch_add(resp.usage.total(), Ordering::Relaxed);
        Ok(resp)
    }
}

/// Status, code and message for a failed turn. The provider's own error text can carry keys,
/// URLs or account details, so only its HTTP status reaches the client (and the log).
pub fn provider_error(e: &AiError) -> (StatusCode, &'static str, String) {
    match e {
        AiError::Timeout => (StatusCode::GATEWAY_TIMEOUT, "ai_timeout", "the AI did not answer in time".into()),
        AiError::Refused => (StatusCode::BAD_GATEWAY, "ai_refused", "AI が応答を拒否しました".into()),
        AiError::Provider { status, .. } => (
            StatusCode::BAD_GATEWAY,
            "ai_provider_error",
            format!("AI provider error (HTTP {status})"),
        ),
        AiError::Unreachable => (StatusCode::BAD_GATEWAY, "ai_provider_error", "AI provider unreachable".into()),
        AiError::Malformed => (StatusCode::BAD_GATEWAY, "ai_provider_error", "unexpected AI provider response".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_ai::testing::ScriptedLlm;
    use rgcs_ai::{AiError, Block, LlmClient, LlmRequest, LlmResponse, Stop, Usage};

    fn reply(input: u64, output: u64) -> LlmResponse {
        LlmResponse {
            blocks: vec![Block::Text("ok".into())],
            stop: Stop::EndTurn,
            usage: Usage { input, output },
        }
    }

    fn req() -> LlmRequest<'static> {
        LlmRequest {
            system: "",
            turns: &[],
            tools: None,
            max_tokens: 16,
        }
    }

    #[tokio::test]
    async fn the_meter_counts_every_answered_call_even_when_a_later_call_fails() {
        let inner = ScriptedLlm::from_results(vec![Ok(reply(100, 20)), Err(AiError::Unreachable)]);
        let meter = Metered::new(&inner);
        assert!(meter.complete(req()).await.is_ok());
        assert!(meter.complete(req()).await.is_err());
        assert_eq!(meter.used(), 120);
    }

    #[test]
    fn a_provider_error_never_echoes_the_provider_text() {
        let e = AiError::Provider {
            status: 401,
            message: "invalid x-api-key sk-ant-abc123 for https://api.example".into(),
        };
        let (status, code, message) = provider_error(&e);
        assert_eq!((status.as_u16(), code), (502, "ai_provider_error"));
        assert!(!message.contains("sk-ant") && !message.contains("https://"), "{message}");
        assert!(message.contains("401"), "{message}");
    }
}
