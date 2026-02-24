import { z } from "zod";

// ---------------------------------------------------------------------------
// Inbound (client → server)
// ---------------------------------------------------------------------------

export const PromptPayloadSchema = z.object({
  prompt: z.string().min(1),
  session_id: z.string().optional(),
});

export const InboundPromptSchema = z.object({
  type: z.literal("prompt"),
  payload: PromptPayloadSchema,
});

export const InboundPingSchema = z.object({
  type: z.literal("ping"),
});

// Client acknowledges a tx was signed by the mobile wallet
export const TxSignedSchema = z.object({
  type: z.literal("tx_signed"),
  payload: z.object({
    tx_id: z.string(),
    signature: z.string(), // base58 Solana tx signature
  }),
});

// Client rejects a signing request
export const TxRejectedSchema = z.object({
  type: z.literal("tx_rejected"),
  payload: z.object({
    tx_id: z.string(),
    reason: z.string().optional(),
  }),
});

export const InboundMessageSchema = z.discriminatedUnion("type", [
  InboundPromptSchema,
  InboundPingSchema,
  TxSignedSchema,
  TxRejectedSchema,
]);

// ---------------------------------------------------------------------------
// Outbound (server → client)
// ---------------------------------------------------------------------------

export const AgentDeltaSchema = z.object({
  type: z.literal("agent_delta"),
  payload: z.object({
    session_id: z.string(),
    text: z.string(),
  }),
});

export const AgentDoneSchema = z.object({
  type: z.literal("agent_done"),
  payload: z.object({
    session_id: z.string(),
    text: z.string(),
  }),
});

export const ToolCallSchema = z.object({
  type: z.literal("tool_call"),
  payload: z.object({
    session_id: z.string(),
    tool: z.string(),
    input: z.unknown(),
  }),
});

export const ToolResultSchema = z.object({
  type: z.literal("tool_result"),
  payload: z.object({
    session_id: z.string(),
    tool: z.string(),
    output: z.unknown(),
  }),
});

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  payload: z.object({
    session_id: z.string(),
    message: z.string(),
  }),
});

export const PongSchema = z.object({
  type: z.literal("pong"),
});

// Server pushes a tx that needs to be signed by the mobile wallet
export const TxSigningRequestSchema = z.object({
  type: z.literal("tx_signing_request"),
  payload: z.object({
    tx_id: z.string(),
    from_token: z.string(),
    to_token: z.string(),
    amount: z.number(),
    serialized_tx: z.string(), // base64-encoded serialized transaction
    trigger: z.object({
      alert_id: z.number(),
      token: z.string(),
      target_price: z.number(),
      triggered_price: z.number(),
      direction: z.enum(["above", "below"]),
    }),
    expires_at: z.string(), // ISO 8601 — client should refuse after this
  }),
});

export const OutboundMessageSchema = z.discriminatedUnion("type", [
  AgentDeltaSchema,
  AgentDoneSchema,
  ToolCallSchema,
  ToolResultSchema,
  ErrorMessageSchema,
  PongSchema,
  TxSigningRequestSchema,
]);

// ---------------------------------------------------------------------------
// REST schemas
// ---------------------------------------------------------------------------

export const PromptRequestSchema = z.object({
  prompt: z.string().min(1),
  session_id: z.string().optional(),
});

export const MessageSchema = z.object({
  id: z.number(),
  session_id: z.string(),
  role: z.enum(["user", "agent"]),
  content: z.string(),
  created_at: z.string(),
});

// ---------------------------------------------------------------------------
// Inferred TS types
// ---------------------------------------------------------------------------

export type PromptPayload = z.infer<typeof PromptPayloadSchema>;
export type InboundMessage = z.infer<typeof InboundMessageSchema>;
export type AgentDelta = z.infer<typeof AgentDeltaSchema>;
export type AgentDone = z.infer<typeof AgentDoneSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type TxSigningRequest = z.infer<typeof TxSigningRequestSchema>;
export type TxSigned = z.infer<typeof TxSignedSchema>;
export type TxRejected = z.infer<typeof TxRejectedSchema>;
export type OutboundMessage = z.infer<typeof OutboundMessageSchema>;
export type PromptRequest = z.infer<typeof PromptRequestSchema>;
export type Message = z.infer<typeof MessageSchema>;
