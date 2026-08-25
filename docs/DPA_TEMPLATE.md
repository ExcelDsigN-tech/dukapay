# DukaPay Data Processing Agreement (DPA)

**Effective Date:** [DATE]
**Between:** DukaPay ("Controller") and Agent ("Processor")

---

## 1. Purpose

This Data Processing Agreement ("DPA") governs the processing of personal data
by agents ("Processors") on behalf of DukaPay ("Controller") in connection with
the provision of financial services through the DukaPay platform.

## 2. Definitions

- **Personal Data**: Any information relating to an identified or identifiable
  natural person, including but not limited to: wallet addresses, transaction
  history, credit scores, email addresses, and phone numbers.
- **Processing**: Any operation performed on personal data, including collection,
  recording, storage, adaptation, retrieval, consultation, use, disclosure,
  erasure, or destruction.
- **Data Subject**: The individual whose personal data is processed (i.e., the
  end user/borrower/lender).

## 3. Processor Obligations

The Agent agrees to:

1. **Process only as instructed**: Process personal data only on documented
   instructions from DukaPay.
2. **Confidentiality**: Ensure that persons authorized to process personal data
   have committed themselves to confidentiality.
3. **Security measures**: Implement appropriate technical and organizational
   measures to ensure a level of security appropriate to the risk (see Section 5).
4. **Sub-processing**: Not engage another processor without DukaPay's prior
   written authorization.
5. **Data subject rights**: Assist DukaPay in responding to data subject rights
   requests (access, deletion, portability).
6. **Breach notification**: Notify DukaPay without undue delay after becoming
   aware of a personal data breach.
7. **Return or deletion**: Upon termination, return or delete all personal data,
   unless retention is required by law.

## 4. Data Processing Activities

The Agent may process the following categories of personal data:

| Category | Examples | Purpose |
|----------|----------|---------|
| Identity Data | Wallet address, display name | Authentication, KYC |
| Financial Data | Transaction history, loan status, credit score | Service provision |
| Contact Data | Email, phone (encrypted) | Notifications, support |
| Technical Data | IP address, device info | Security, fraud prevention |

## 5. Technical Security Measures

The Agent must implement:

- [ ] AES-256-GCM encryption for PII at rest
- [ ] TLS 1.2+ for all data in transit
- [ ] Role-based access control (RBAC) with least privilege
- [ ] Audit logging for all data access
- [ ] Regular security assessments
- [ ] Incident response plan

## 6. Data Subject Rights

The Agent shall assist DukaPay in fulfilling the following data subject rights:

- **Right of Access** (GDPR Art. 15): Provide a copy of all personal data
- **Right to Erasure** (GDPR Art. 17): Delete PII while preserving anonymized
  financial records for accounting compliance
- **Right to Data Portability** (GDPR Art. 20): Export data in structured,
  machine-readable format

## 7. Cross-Border Transfers

Personal data shall not be transferred to a third country or international
organization without appropriate safeguards (GDPR Art. 46), including:

- Standard Contractual Clauses (SCCs)
- Binding Corporate Rules (BCRs)
- Adequacy decisions

## 8. Liability

The Agent shall indemnify DukaPay against all claims, damages, and expenses
arising from the Agent's failure to comply with this DPA or applicable data
protection laws.

## 9. Term and Termination

This DPA remains in effect for the duration of the processing relationship.
Upon termination, the Agent shall return or securely destroy all personal data
within 30 days.

## 10. Governing Law

This DPA is governed by the laws of [JURISDICTION], without regard to conflict
of law principles.

---

**Controller:** DukaPay
**Signature:** _________________________
**Date:** _________________________

**Processor:** [Agent Name]
**Signature:** _________________________
**Date:** _________________________
