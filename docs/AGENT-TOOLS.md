# Model-selected tools (2026-10-29)

Live mode now uses campus-qwen to choose tools inside LangGraph specialist nodes. The campus service was verified with our schema-validated JSON selection protocol; this is not native OpenAI function calling. Each selection is a real model request. LangChain StructuredTool executes only allowlisted request-bound functions. Model text never becomes Python, SQL, a payment amount, a URL, or a different order identifier.

## Tools and handoffs

- SupervisionAgent: read current policies, delegate to a permitted specialist, request policy direction where the existing conflict rules require it, finish a completed proposal.
- ListingAgent: inspect request, read policy, validate listing fields and review photos (existing visual assessment uses campus-qwen; explicit demo photos remain labelled as demo checks).
- PricingAgent: inspect request/read policy, search public market sources, then estimate from retrieved comparables and submitted attributes. The estimate tool is unavailable before search. Photo assessment remains a prerequisite. Unavailable data never becomes a fabricated price.
- MatchingAgent: parse preferences using campus-qwen when text is supplied, run hard filtering and ranking as a tool. Removed keyword fallback after model error/empty response.
- LogisticsAgent: inspect order/policy; validate and prepare the requested quote, building reply, carrier acceptance, pickup or delivery against a copy of current state.
- PaymentAgent: validate and prepare simulated purchase or buyer acceptance plus settlement. A delivery event does not visit PaymentAgent merely because the old fixed route included it.
- AuditReportingAgent: read exact database-derived report totals; never generate financial figures with the model.

Tools have no model-controlled arguments: the selected demo role and validated action payload bind their scope. The planner chooses which allowed tool to call and receives structured observations. Tools cannot replace the requested action or bypass prerequisite tools. Role boundaries, operation authorization, finite loops, and live transactional guards remain enforced by code. This is bounded agent autonomy, not an unrestricted general-purpose agent.

## Commit and failure policy

State-changing tools prepare a validated proposal on a snapshot; they do not mutate production state. After the model finishes, the existing database transaction checks current inventory/order/quote state again and applies the requested effect atomically. Unique command receipts and settlement constraints remain authoritative. Retrying a completed command does not pay twice.

Any failed/invalid planner call, unavailable required visual/preference call, invalid tool choice or exhausted budget aborts before commit with HTTP 503 and retryable=true. The seller/buyer form stays mounted with its entries. The frontend retains existing loading/retry interaction. There is no rule fallback in live mode. The per-action model workflow has a 150-second budget below the 180-second proxy timeout; late completion is rejected before commit. Human policy replies refresh their snapshot/budget.

Fixture mode remains an explicitly selected offline test/demo mode, never an automatic recovery path. Clock controls, media upload, role navigation, and form validation remain ordinary application utilities. No real payment or email service was added.

## Evidence

Admin workflows show actual model calls, durations, tool selection, short operational purpose, tool result and tool duration. These are execution evidence and brief decisions, not private model chain-of-thought. Old historical events are not retroactively labelled as model calls. Buyer/seller responses continue to strip internal execution data. Reports and paused requests retain sanitized audit records.
