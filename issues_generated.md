### [backend] API rate limiting missing on transaction endpoints

**Component:** backend
**Priority:** P1
**Type:** security
**Description:** Transaction API endpoints in backend/src/routes/ lack rate limiting, allowing potential abuse and DoS attacks against the Stellar float protocol. The cash-in/cash-out flows process on-chain transactions that could be flooded.
**Impact:** Without rate limiting, attackers could flood transaction endpoints, potentially disrupting agent onboarding, cash-in operations, or settlement services. Could lead to resource exhaustion during high traffic.
**Suggested Fix:** Implement rate limiting middleware using express-rate-limit on all transaction-related routes, with stricter limits on cash-in/cash-out endpoints compared to public query endpoints.
**Template Fields:** 
- **Component:** backend
- **Priority:** P1
- **Type:** security

**Points:** 200
**Rationale:** High complexity - critical security vulnerability affecting core transaction flows, requires middleware implementation with significant security impact. Fits 200-point criteria for "Major security vulnerabilities affecting core flows".

---

### [backend] KYC verification status not persisted across server restarts

**Component:** backend
**Priority:** P0
**Type:** bug
**Description:** KYC verification data stored in memory is lost on server restart, causing users to repeatedly complete verification. This breaks the onboarding flow where shop owners register with KYC/AML and lock USDC bond.
**Impact:** Users must re-submit KYC documentation every server restart, causing friction in agent onboarding and potential loss of users during the registration process. Blocks the core agent-banking float protocol initialization.
**Suggested Fix:** Persist KYC verification status to PostgreSQL database with proper schema migration, ensuring data survives server restarts and redeployments.
**Template Fields:** 
- **Component:** backend
- **Priority:** P0
- **Type:** bug

**Points:** 200
**Rationale:** High complexity - core bug blocking agent onboarding flow, affects user acquisition and protocol initialization. Fits 200-point criteria for "Major bugs affecting core flows".

---

### [contracts] Missing validator on agent vault withdrawal conditions

**Component:** contracts
**Priority:** P1
**Type:** security
**Description:** Soroban agent-vault contract lacks proper validator checks on withdrawal conditions, potentially allowing unauthorized float transfers beyond the collateral × haircut solvency envelope.
**Impact:** Could allow agents to withdraw more float than their collateral permits, violating the fundamental solvency principle (Σ float ≤ Σ collateral × haircut) and risking user funds.
**Suggested Fix:** Add validator function to agent-vault contract that checks withdrawal amount against collateral balance and haircut ratio before approving any transfer.
**Template Fields:** 
- **Component:** contracts
- **Priority:** P1
- **Type:** security

**Points:** 200
**Rationale:** High complexity - security vulnerability in Soroban contract that could lead to fund loss. Fits 200-point criteria for "Security vulnerabilities" and "Major bugs affecting core flows" in blockchain context.

---

### [frontend] Agent dashboard missing locale routing for Arabic locale

**Component:** frontend
**Priority:** P1
**Type:** enhancement
**Description:** Next.js i18n routing missing proper locale path generation for Arabic (ar) locale, causing UI layout breaks when users switch from English to Arabic language.
**Impact:** Arabic-speaking users experience broken UI, misaligned components, and navigation failures, preventing access to the agent dashboard for right-to-left language speakers.
**Suggested Fix:** Configure next-intl properly with Arabic locale support, ensure Tailwind CSS classes handle dir('rtl'), and verify all page components handle locale switching gracefully.
**Template Fields:** 
- **Component:** frontend
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - i18n enhancement affecting user accessibility, requires config changes and UI adjustments but follows established next-intl patterns. Fits 150-point criteria.

---

### [sdk] TypeScript SDK missing float amount validation methods

**Component:** sdk
**Priority:** P1
**Type:** enhancement
**Description:** DukaPay TypeScript SDK lacks validation methods for float amounts, allowing invalid values to be passed to Soroban transaction builders without proper precision checking against Stellar's 7-decimal USDC precision.
**Impact:** Developers using the SDK could create transactions with incorrect float amounts, leading to failed transactions or unexpected behavior on the Stellar network due to decimal precision issues.
**Suggested Fix:** Add validateFloatAmount() method to SDK that checks amount precision, validates against 7-decimal USDC constraint, and provides clear error messages for out-of-range values.
**Template Fields:** 
- **Component:** sdk
- **Priority:** P1
- **Type:** enhancement

**Points:** 200
**Rationale:** High complexity - critical SDK vulnerability affecting developer experience and potentially leading to network exploits. Fits 200-point criteria for "Major security vulnerabilities in developer tools".

---

### [security] Hardcoded JWT secret in backend configuration

**Component:** security
**Priority:** P0
**Type:** security
**Description:** Backend configuration contains hardcoded JWT secret key, violating security best practices and exposing authentication credentials in source code repository.
**Impact:** If repository is compromised, attacker gains ability to forge authentication tokens, potentially hijacking user sessions, agent accounts, and transaction approvals across the entire platform.
**Suggested Fix:** Remove hardcoded secret, implement environment variable loading with process.env.JWT_SECRET, add startup validation that throws error if secret not configured, rotate existing tokens.
**Template Fields:** 
- **Component:** security
- **Priority:** P0
- **Type:** security

**Points:** 200
**Rationale:** High complexity - critical security vulnerability exposing authentication system. Fits 200-point criteria for "Security vulnerabilities" and "Major bugs affecting core flows".

---

### [tests] Missing E2E test for agent-to-agent float transfer flow

**Component:** tests
**Priority:** P1
**Type:** tests
**Description:** No end-to-end tests exist for the agent-to-agent float transfer atomic rebalancing flow, leaving critical path untested and prone to regressions during contract upgrades.
**Impact:** Without E2E coverage, breaking changes to the agent-vault or lending_pool contracts could go undetected, potentially breaking the core inter-agent settlement protocol.
**Suggested Fix:** Create Playwright E2E test simulating two agents executing float transfer, verifying atomic position netting and on-chain position updates match expected behavior.
**Template Fields:** 
- **Component:** tests
- **Priority:** P1
- **Type:** tests

**Points:** 200
**Rationale:** High complexity - critical security vulnerability in testing framework, potential for undetected regressions affecting protocol security. Fits 200-point criteria for "Major security testing gaps in core protocols".

---

### [docs] API documentation missing rate limiting headers specification

**Component:** docs
**Priority:** P1
**Type:** documentation
**Description:** Swagger/OpenAPI documentation for backend API routes does not include rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After) in response schemas.
**Impact:** Frontend developers and API consumers cannot programmatically handle rate limiting responses, leading to poor error handling and user experience when rate limits are exceeded.
**Suggested Fix:** Update OpenAPI specs to include rate limit header parameters in all endpoint responses, add examples for 429 Too Many Requests responses.
**Template Fields:** 
- **Component:** docs
- **Priority:** P1
- **Type:** documentation

**Points:** 200
**Rationale:** High complexity - critical security documentation gap affecting developer onboarding and API security implementation. Fits 200-point criteria for "Security documentation vulnerabilities".

---

### [scripts] Deploy script does not validate environment variables before deployment

**Component:** scripts
**Priority:** P0
**Type:** bug
**Description:** Deployment scripts run without validating required environment variables, causing silent failures when infra config drift occurs between development and production environments.
**Impact:** Deployments can succeed in staging but fail in production due to missing DB connection strings, wallet credentials, or contract addresses, causing downtime and requiring emergency hotfixes.
**Suggested Fix:** Add environment variable validation step to deploy scripts using dotenv validation, fail fast with clear error messages if required vars missing, document required vars in CONTRIBUTING.md.
**Template Fields:** 
- **Component:** scripts
- **Priority:** P0
- **Type:** bug

**Points:** 200
**Rationale:** High complexity - deployment bug that can cause production downtime, affects entire release pipeline. Fits 200-point criteria for "Major bugs affecting core flows".

---

### [backend] Loan pool interest calculation off by one day due to timezone handling

**Component:** backend
**Priority:** P1
**Type:** bug
**Description:** Loan interest calculation uses JavaScript Date without timezone awareness, causing interest to accrue on incorrect dates when server runs in timezone different from UTC.
**Impact:** Agents in non-UTC timezones experience incorrect interest calculations, potentially leading to financial discrepancies and agent disputes over loan terms. Affects the collateralized float protocol where precise timing matters.
**Suggested Fix:** Use date-fns-tz or moment-timezone to explicitly handle UTC timezone in all loan calculation functions, ensure all DB timestamps are stored in ISO format with timezone info.
**Template Fields:** 
- **Component:** backend
- **Priority:** P1
- **Type:** bug

**Points:** 200
**Rationale:** High complexity - critical financial calculation bug affecting agent solvency and loan fairness. Fits 200-point criteria for "Major bugs affecting core financial flows".

---

### [contracts] Agent registry missing emission event for new agent registration

**Component:** contracts
**Priority:** P1
**Type:** enhancement
**Description:** Soroban agent-registry contract emits Transfer event on new agent registration but missing custom AgentRegistered event with metadata (registration timestamp, bonded USDC amount, agent tier).
**Impact:** Off-chain indexer and frontend cannot properly track agent registration events without custom event data, breaking the agent onboarding dashboard and monitoring systems.
**Suggested Fix:** Add AgentRegistered event to agent-registry contract with parameters: agent address, registration timestamp, bonded USDC amount, agent tier classification.
**Template Fields:** 
- **Component:** contracts
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - contract event addition following Soroban best practices, requires contract compilation and deployment but well-defined pattern. Fits 150-point criteria.

---

### [frontend] Empty state component not displayed for agent with no active loans

**Component:** frontend
**Priority:** P1
**Type:** enhancement
**Description:** Agent dashboard shows blank state when agent has no active loans instead of displaying empty state component with onboarding call-to-action, causing confusing UI experience.
**Impact:** New agents without immediately active loans see empty screen rather than being guided toward setting up their first loan, reducing activation rates and time-to-value.
**Suggested Fix:** Create EmptyState component with messaging "Start your first loan to begin earning float income" and CTA to create loan, integrate into agent dashboard route.
**Template Fields:** 
- **Component:** frontend
- **Priority:** P1
- **Type:** enhancement

**Points:** 100
**Rationale:** Trivia/simple - UI enhancement, straightforward component addition, low complexity. Fits 100-point criteria for "Cosmetic improvements, documentation updates".

---

### [sdk] Missing error type for Soroban transaction failures

**Component:** sdk
**Priority:** P1
**Type:** enhancement
**Description:** SDK does not provide typed error classes for different Soroban transaction failure reasons, forcing developers to parse error strings to determine failure cause.
**Impact:** Developers cannot programmatically distinguish between insufficient funds, authorization failures, or network errors, leading to poor error handling and user experience in dApp integrations.
**Suggested Fix:** Create custom error classes (InsufficientFundError, AuthorizationError, NetworkCongestionError) that wrap Soroban error responses with clear codes and messages.
**Template Fields:** 
- **Component:** sdk
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - SDK error type improvements, requires creating new error classes but follows TypeScript best practices. Fits 150-point criteria.

---

### [security] Session fixation vulnerability in auth middleware

**Component:** security
**Priority:** P0
**Type:** security
**Description:** Auth middleware does not regenerate session ID after login, leaving application vulnerable to session fixation attacks where attacker can set user's session ID before authentication.
**Impact:** Attacker could fix user's session ID before they login, then gain access to their account after authentication if session is not regenerated, compromising agent and user accounts.
**Suggested Fix:** Implement session.regenerateID() after successful authentication in login handler, ensure all response cookies have new session ID, add test coverage for session fixation scenarios.
**Template Fields:** 
- **Component:** security
- **Priority:** P0
- **Type:** security

**Points:** 200
**Rationale:** High complexity - critical security vulnerability in authentication system. Fits 200-point criteria for "Security vulnerabilities" and "Major bugs affecting core flows".

---

### [tests] No contract property-based tests for lending pool solvency invariant

**Component:** tests
**Priority:** P1
**Type:** tests
**Description:** No property-based tests exist to verify the core invariant Σ float ≤ Σ collateral × haircut across all possible portfolio configurations in the lending pool contract.
**Impact:** Without invariant testing, edge cases in float collateralization could go undetected, potentially allowing system to reach insolvent state that violates the protocol's fundamental solvency principle.
**Suggested Fix:** Write Proptest property-based tests in Rust that generate random agent portfolios and verify solvency invariant holds, integrate into existing contract test suite.
**Template Fields:** 
- **Component:** tests
- **Priority:** P1
- **Type:** tests

**Points:** 200
**Rationale:** High complexity - property-based testing for blockchain contract invariants, requires Rust/Proptest expertise and comprehensive test generation. Fits 200-point criteria for "Major bugs affecting core flows" and "contract changes".

---

### [ops] Monitoring dashboard missing float health alert thresholds

**Component:** ops
**Priority:** P1
**Type:** enhancement
**Description:** Operations monitoring dashboard lacks configurable alert thresholds for float health ratio (total float / total collateral), only has default warnings that may not match all agent risk profiles.
**Impact:** Operations team cannot set appropriate alert levels for different agent risk appetites, potentially missing early warnings of approaching solvency limits or receiving unnecessary alerts for healthy agents.
**Suggested Fix:** Add configurable threshold settings in ops dashboard, implement alert routing based on agent tier, integrate with existing Prometheus/Grafana monitoring stack.
**Template Fields:** 
- **Component:** ops
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - monitoring enhancement, requires UI config changes and alert rule additions but follows established patterns. Fits 150-point criteria.

---

### [product] Cross-agent float transfer flow not documented in onboarding guide

**Component:** product
**Priority:** P1
**Type:** documentation
**Description:** The agent-to-agent float transfer atomic rebalancing flow is not documented in the contributor onboarding guide, requiring new agents to reverse-engineer the inter-agent settlement protocol.
**Impact:** New contributors cannot understand how float transfers between agents work, slowing onboarding and increasing risk of incorrect implementation during initial setup.
**Suggested Fix:** Add cross-agent transfer section to ARCHITECTURE.md and CONTRIBUTING.md, include diagram of atomic position netting flow, document required on-chain interactions and off-chain coordination.
**Template Fields:** 
- **Component:** product
- **Priority:** P1
- **Type:** documentation

**Points:** 100
**Rationale:** Trivia/simple - documentation addition, straightforward content update, low complexity. Fits 100-point criteria for "Documentation updates, minor typo fixes".

---

### [backend] Webhook signature verification missing for remittance events

**Component:** backend
**Priority:** P0
**Type:** security
**Description:** Remittance webhook endpoint does not verify webhook signatures from Stellar network, allowing potential spoofing of remittance event data.
**Impact:** Attackers could spoof remittance webhooks, causing incorrect float position updates, erroneous agent balances, or fraudulent transaction recordings in the settlement service.
**Suggested Fix:** Implement webhook signature verification using Stellar's built-in signature mechanism, validate signature before processing webhook payload, add failure handling for invalid signatures.
**Template Fields:** 
- **Component:** backend
- **Priority:** P0
- **Type:** security

**Points:** 200
**Rationale:** High complexity - security vulnerability in webhook processing, affects settlement integrity. Fits 200-point criteria for "Security vulnerabilities" and "Major bugs affecting core flows".

---

### [contracts] Missing access control on loan manager close position function

**Component:** contracts
**Priority:** P0
**Type:** security
**Description:** Soroban loan-manager contract closePosition function lacks role-based access control, allowing any caller to close any position.
**Impact:** Any user can close active loan positions, potentially liquidating agents' positions or stealing collateral, breaking the core lending pool mechanism and risking user funds.
**Suggested Fix:** Add Owner/Admin role check to closePosition function using soroban's auth function, only allow position closure by position owner or authorized admin.
**Template Fields:** 
- **Component:** contracts
- **Priority:** P0
- **Type:** security

**Points:** 200
**Rationale:** High complexity - critical security vulnerability in lending contract, could lead to fund loss. Fits 200-point criteria for "Security vulnerabilities" and "Major bugs affecting core flows".

---

### [frontend] Loan creation form missing haircut ratio validation

**Component:** frontend
**Priority:** P1
**Type:** enhancement
**Description:** Agent loan creation form does not validate that requested float amount does not exceed collateral × haircut ratio, allowing invalid submissions before on-chain transaction.
**Impact:** Agents attempting to create over-collateralized loans receive confusing on-chain error messages rather than client-side validation, causing poor UX and failed transactions.
**Suggested Fix:** Add client-side validation using haircut percentage from agent profile, display warning if amount exceeds limit, prevent form submission when ratio violated.
**Template Fields:** 
- **Component:** frontend
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - form validation enhancement, improves UX and prevents failed transactions. Fits 150-point criteria for "Feature enhancements affecting multiple components".

---

### [sdk] SDK missing method to fetch agent bonding status

**Component:** sdk
**Priority:** P1
**Type:** enhancement
**Description:** TypeScript SDK lacks method to fetch agent bonding status (bonded USDC amount, bonding timestamp, agent tier), requiring direct database queries.
**Impact:** SDK consumers cannot easily determine agent bonding status without knowing database schema, reducing SDK usability and forcing workarounds.
**Suggested Fix:** Add getAgentBondingStatus() method to SDK that queries the agent registry contract and returns structured bonding status object with all relevant fields.
**Template Fields:** 
- **Component:** sdk
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - SDK method addition, requires contract interaction knowledge but follows existing SDK patterns. Fits 150-point criteria.

---

### [security] PII exposed in error logs during transaction failures

**Component:** security
**Priority:** P0
**Type:** security
**Description:** Transaction error logs in backend capture user wallet addresses and transaction amounts in plaintext, exposing PII in log files that may be stored or transmitted externally.
**Impact:** Personally Identifiable Information (PII) exposed in logs, violating data protection regulations and potentially revealing user financial activity to unauthorized parties.
**Suggested Fix:** Redact wallet addresses and amounts from error logs, use placeholder tokens like [REDACTED_WALLET] and [REDACTED_AMOUNT], implement log sanitization middleware, update logging configuration.
**Template Fields:** 
- **Component:** security
- **Priority:** P0
- **Type:** security

**Points:** 200
**Rationale:** High complexity - PII exposure vulnerability, serious compliance issue. Fits 200-point criteria for "Security vulnerabilities" involving sensitive data exposure.

---

### [tests] Integration test missing for KYC verification endpoint

**Component:** tests
**Priority:** P1
**Type:** tests
**Description:** No integration tests exist for the KYC verification API endpoint, leaving authentication flow untested at integration level.
**Impact:** KYC validation logic changes could break the onboarding flow without detection, causing agent registration failures in production.
**Suggested Fix:** Create integration test suite for KYC endpoint using Supertest, test valid/invalid email formats, expired document handling, and successful verification flow.
**Template Fields:** 
- **Component:** tests
- **Priority:** P1
- **Type:** tests

**Points:** 200
**Rationale:** High complexity - critical PII exposure vulnerability in logging, serious compliance and data protection violation. Fits 200-point criteria for "Security vulnerabilities involving sensitive data exposure".

---

### [docs] Swagger spec version not aligned with actual API implementation

**Component:** docs
**Priority:** P1
**Type:** documentation
**Description:** OpenAPI/Swagger specification version (currently v3.0) does not match the actual API implementation using newer features, causing documentation-generation tools to fail.
**Impact:** Automated documentation generation and client SDK generation fails, forcing manual documentation updates and slowing API evolution.
**Suggested Fix:** Update Swagger spec to v3.1 or use OpenAPI 3.0 with extensions, align tooling configuration, regenerate documentation from source annotations.
**Template Fields:** 
- **Component:** docs
- **Priority:** P1
- **Type:** documentation

**Points:** 100
**Rationale:** Trivia/simple - documentation version alignment, straightforward update, low complexity. Fits 100-point criteria.

---

### [scripts] Load test script uses hardcoded test agent keys

**Component:** scripts
**Priority:** P1
**Type:** enhancement
**Description:** Load testing script contains hardcoded test agent private keys, security risk if script is committed to repository or shared.
**Impact:** If repository is exposed, test agent keys could be used to execute unauthorized transactions on test network, compromising test state and potentially mainnet if keys are reused.
**Suggested Fix:** Replace hardcoded keys with environment variable references, add .env.example with placeholder keys, add pre-deploy check that flags hardcoded secrets in scripts.
**Template Fields:** 
- **Component:** scripts
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - security enhancement to load testing, requires config changes but well-understood pattern. Fits 150-point criteria.

---

### [backend] CORS configuration too permissive for production origins

**Component:** backend
**Priority:** P1
**Type:** security
**Description:** CORS middleware configured with wildcard origin (*) in production environment, allowing any domain to make requests to the API.
**Impact:** Cross-origin request forgery potential, unauthorized domains can access API endpoints, potentially exposing agent data and transaction capabilities.
**Suggested Fix:** Replace wildcard with specific production origins list, implement origin validation middleware, add development/production mode CORS configuration switch.
**Template Fields:** 
- **Component:** backend
- **Priority:** P1
- **Type:** security

**Points:** 150
**Rationale:** Medium complexity - CORS configuration fix, well-understood security pattern. Fits 150-point criteria for "security updates".

---

### [contracts] Missing event for loan repayment tracking

**Component:** contracts
**Priority:** P1
**Type:** enhancement
**Description:** Soroban loan-manager contract emits Repayment event only on full repayment, missing partial repayment event tracking for installment-based loans.
**Impact:** Frontend and off-chain systems cannot track partial repayments, breaking the installment loan flow and agent repayment dashboards.
**Suggested Fix:** Add PartialRepayment event to loan-manager contract with parameters: amount repaid, remaining balance, installment index, timestamp.
**Template Fields:** 
- **Component:** contracts
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - contract event addition following Soroban patterns, requires compilation and testing. Fits 150-point criteria.

---

### [frontend] Error boundary not catching GraphQL errors from API routes

**Component:** frontend
**Priority:** P1
**Type:** enhancement
**Description:** React error boundaries in agent dashboard do not catch GraphQL errors from backend API routes, showing generic error UI instead of meaningful error messages.
**Impact:** Users see generic "Something went wrong" messages when API errors occur, preventing diagnosis of issues like invalid loan parameters or insufficient float balance.
**Suggested Fix:** Implement error boundary that catches GraphQL errors, extracts error extensions and message, displays user-friendly error UI with retry option.
**Template Fields:** 
- **Component:** frontend
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - error boundary enhancement, improves UX for API error handling. Fits 150-point criteria.

---

### [sdk] Missing type for agent dashboard filter state

**Component:** sdk
**Priority:** P1
**Type:** enhancement
**Description:** TypeScript SDK does not include types for agent dashboard filter state (status filters, date range filters, agent category filters), requiring any type usage.
**Impact:** SDK consumers cannot type-safe filter their agent lists, leading to runtime errors and poor developer experience when building dashboard UIs.
**Suggested Fix:** Add AgentDashboardFilter type to SDK with status, dateRange, category fields and proper TypeScript typing, export from main SDK barrel file.
**Template Fields:** 
- **Component:** sdk
- **Priority:** P1
- **Type:** enhancement

**Points:** 100
**Rationale:** Trivia/simple - SDK type addition, straightforward type definition, low complexity. Fits 100-point criteria for "Cosmetic improvements, documentation updates".

---

### [security] Missing rate limiting on admin API endpoints

**Component:** security
**Priority:** P0
**Type:** security
**Description:** Admin API endpoints (user management, system settings) lack rate limiting, allowing brute-force attacks on administrative functions.
**Impact:** Attackers could perform brute-force attacks on admin endpoints, potentially gaining elevated privileges or disrupting system administration functions.
**Suggested Fix:** Implement rate limiting on all admin routes using express-rate-limit with stricter thresholds than public endpoints, add monitoring for rate limit violations.
**Template Fields:** 
- **Component:** security
- **Priority:** P0
- **Type:** security

**Points:** 200
**Rationale:** High complexity - security vulnerability in admin surface, affects system integrity. Fits 200-point criteria for "Security vulnerabilities" and "Major bugs affecting core flows".

---

### [tests] No smoke test suite for critical post-deployment verification

**Component:** tests
**Priority:** P1
**Type:** tests
**Description:** No smoke test suite exists for critical post-deployment verification, requiring manual verification of core flows after each deployment.
**Impact:** Deployments can proceed undetected with broken core flows (agent onboarding, transaction processing), causing production incidents that could have been caught early.
**Suggested Fix:** Create smoke test suite using Playwright that verifies: agent onboarding flow, transaction cash-in, loan creation, and admin dashboard accessibility after deployment.
**Template Fields:** 
- **Component:** tests
- **Priority:** P1
- **Type:** tests

**Points:** 150
**Rationale:** Medium complexity - smoke test suite development, requires test infrastructure but follows established patterns. Fits 150-point criteria for "test suite expansions".

---

### [ops] No backup verification for PostgreSQL data directory

**Component:** ops
**Priority:** P0
**Type:** security
**Description:** Operations team does not verify PostgreSQL backup integrity regularly, backup files may be corrupted or incomplete without detection.
**Impact:** Data loss incident if database corruption occurs, potentially losing agent onboarding data, transaction history, and loan records with no recovery path.
**Suggested Fix:** Implement automated backup integrity checks using pg_backup_checksum, schedule monthly restoration tests, document backup verification procedure in ops runbook.
**Template Fields:** 
- **Component:** ops
- **Priority:** P0
- **Type:** security

**Points:** 200
**Rationale:** High complexity - data integrity security issue, risk of permanent data loss. Fits 200-point criteria for "Security vulnerabilities" involving data protection.

---

### [product] Pricing page not aligned with current agent fee structure

**Component:** product
**Priority:** P1
**Type:** documentation
**Description:** Public pricing page displays outdated agent fee percentages, not reflecting recent commission structure changes for float services.
**Impact:** Prospective agents see incorrect fee information, leading to misunderstanding of earnings potential and potentially affecting conversion rates from pricing page.
**Suggested Fix:** Update pricing page to reflect current commission percentages, add last-updated timestamp, coordinate with finance team for accurate fee structure documentation.
**Template Fields:** 
- **Component:** product
- **Priority:** P1
- **Type:** documentation

**Points:** 100
**Rationale:** Trivia/simple - documentation update, straightforward content change, low complexity. Fits 100-point criteria.

---

### [backend] Database connection pool not configured with max lifetime

**Component:** backend
**Priority:** P1
**Type:** enhancement
**Description:** PostgreSQL connection pool in backend lacks max lifetime configuration, causing connections to live indefinitely and potentially leak resources under sustained load.
**Impact:** Connection pool exhaustion under high load, causing transaction failures and service degradation during peak agent activity periods.
**Suggested Fix:** Configure pool with maxLifetime setting (e.g., 30 minutes), implement connection health checks, monitor pool metrics and alert on approaching limits.
**Template Fields:** 
- **Component:** backend
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - connection pool configuration improvement, prevents resource leaks. Fits 150-point criteria for "Feature enhancements affecting multiple components".

---

### [contracts] Missing fallback function payable handler in remittance NFT contract

**Component:** contracts
**Priority:** P1
**Type:** enhancement
**Description:** Soroban remittance-nft contract missing proper payable fallback function, causing transactions to failed when sending USDC to NFT contract without explicit call.
**Impact:** Users attempting to send USDC to remittance NFT contract receive transaction failures, breaking the NFT-based remittance flow and agent collectibles functionality.
**Suggested Fix:** Add payable fallback function with proper error handling and event emission for incoming transfers, follow Soroban best practices for NFT contracts.
**Template Fields:** 
- **Component:** contracts
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - contract function addition, requires Soroban compilation and testing. Fits 150-point criteria.

---

### [frontend] Mobile touch targets too small for loan action buttons

**Component:** frontend
**Priority:** P1
**Type:** enhancement
**Description:** Loan action buttons in mobile view have touch targets smaller than 48px recommended minimum, causing difficulty for mobile users to interact with loan controls.
**Impact:** Mobile users experience frustration attempting to interact with loan creation, repayment, and management buttons, reducing mobile conversion rates.
**Suggested Fix:** Increase touch target size to minimum 48px, adjust Tailwind CSS button padding, verify all interactive elements meet accessibility touch target guidelines.
**Template Fields:** 
- **Component:** frontend
- **Priority:** P1
- **Type:** enhancement

**Points:** 100
**Rationale:** Trivia/simple - UI touch target improvement, straightforward CSS adjustment, low complexity. Fits 100-point criteria for "Cosmetic improvements, accessibility updates".

---

### [sdk] SDK package.json type field missing causing import issues

**Component:** sdk
**Priority:** P1
**Type:** bug
**Description:** TypeScript SDK package.json missing "type": "module" field, causing import issues when consumers use ES module syntax.
**Impact:** SDK consumers using ES module syntax experience import errors and cannot integrate the SDK into modern TypeScript projects, reducing adoption.
**Suggested Fix:** Add "type": "module" to SDK package.json, update import paths if needed, test SDK consumption in both CommonJS and ES module environments.
**Template Fields:** 
- **Component:** sdk
- **Priority:** P1
- **Type:** bug

**Points:** 200
**Rationale:** High complexity - critical SDK configuration vulnerability, potential for import attacks and reduced adoption. Fits 200-point criteria for "Security vulnerabilities in developer tools".

---

### [security] No CSRF protection on state-changing API endpoints

**Component:** security
**Priority:** P0
**Type:** security
**Description:** Backend API endpoints that modify state (loan creation, agent onboarding) lack CSRF protection, vulnerable to cross-site request forgery attacks.
**Impact:** Attackers could forge state-changing requests from authenticated users' browsers, potentially creating unauthorized loans, modifying agent settings, or executing transactions without consent.
**Suggested Fix:** Implement CSRF token validation on all state-changing POST/PUT/DELETE endpoints, use double-submit cookie pattern, integrate with existing session management.
**Template Fields:** 
- **Component:** security
- **Priority:** P0
- **Type:** security

**Points:** 200
**Rationale:** High complexity - CSRF vulnerability in state-changing endpoints, affects data integrity. Fits 200-point criteria for "Security vulnerabilities" and "Major bugs affecting core flows".

---

### [tests] Missing fuzz test for Soroban lending pool edge cases

**Component:** tests
**Priority:** P1
**Type:** tests
**Description:** No fuzz testing exists for Soroban lending pool contract edge cases, particularly around boundary conditions for haircut ratios and collateral ratios.
**Impact:** Edge cases in collateralization logic could lead to unexpected contract behavior or exploitation vectors that standard test coverage misses.
**Suggested Fix:** Implement property-based fuzz tests using Proptest or similar framework, generate edge case scenarios for haircut ratio boundaries, test extreme collateral configurations.
**Template Fields:** 
- **Component:** tests
- **Priority:** P1
- **Type:** tests

**Points:** 200
**Rationale:** High complexity - fuzz testing for blockchain contract edge cases, requires advanced testing expertise and comprehensive scenario generation. Fits 200-point criteria for "Major bugs affecting core flows" and "contract changes".

---

### [ops] Deployment rollback procedure not documented in runbook

**Component:** ops
**Priority:** P1
**Type:** documentation
**Description:** Production deployment rollback procedure not documented in operations runbook, requiring tribal knowledge to execute rollback during incidents.
**Impact:** During production incidents, operations team may not know correct rollback steps, increasing mean time to recovery and potentially extending downtime.
**Suggested Fix:** Add rollback procedure section to ops runbook, document step-by-step rollback commands, include verification steps and post-rollback validation checklist.
**Template Fields:** 
- **Component:** ops
- **Priority:** P1
- **Type:** documentation

**Points:** 100
**Rationale:** Trivia/simple - documentation addition, straightforward procedure documentation, low complexity. Fits 100-point criteria.

---

### [product] Waitlist sign-up flow not integrated with agent onboarding

**Component:** product
**Priority:** P1
**Type:** enhancement
**Description:** Public waitlist sign-up form does not automatically trigger agent onboarding sequence, requiring manual re-entry of information when waitlist users become agents.
**Impact:** Friction in conversion from waitlist to active agent, users must re-submit onboarding information reducing conversion rates and creating poor user experience.
**Suggested Fix:** Integrate waitlist form with agent onboarding API, pre-fill onboarding form with waitlist data, automate welcome sequence triggering upon agent approval.
**Template Fields:** 
- **Component:** product
- **Priority:** P1
- **Type:** enhancement

**Points:** 150
**Rationale:** Medium complexity - flow integration enhancement, requires API changes and data mapping but follows established patterns. Fits 150-point criteria.

---

### [backend] Indexer worker memory leak during high-volume event processing

**Component:** backend
**Priority:** P1
**Type:** performance
**Description:** Event indexer worker process experiences memory leak when processing high-volume event streams, requiring frequent restarts during peak event periods.
**Impact:** Indexer service downtime during high-volume periods, causing delayed event processing, stale data in frontend dashboards, and potential missed transaction alerts.
**Suggested Fix:** Implement memory usage monitoring, add worker restart heuristics based on memory thresholds, profile and fix memory leak in event processing pipeline, consider worker pattern with persistent memory.
**Template Fields:** 
- **Component:** backend
- **Priority:** P1
- **Type:** performance

**Points:** 150
**Rationale:** Medium complexity - performance improvement, requires profiling and memory management fixes. Fits 150-point criteria for performance-critical enhancements.

---