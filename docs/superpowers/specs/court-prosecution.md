# Feature Court - Prosecution Arguments (Round 3)

**Date:** 2026-03-28
**Role:** Prosecution (argues for strict interpretation of the approved contract)
**Principle:** No silent scope creep after approval

---

### C-01 - Canonical Stack Only
Implementation must follow the six canonical documents named in `document-review.md`. Research notes and feature-candidate files are not fallback authority.

### C-02 - Revision Checks Are Mandatory
The editor and MCP host now share one draft-graph mutation contract. Any implementation that bypasses `baseRevision` conflict handling reopens the ambiguity the stack just closed.

### C-03 - Flagship Loop Shape Is Fixed
The approval loop is WhileLoop + Router + Break. Teams should not invent a hidden boolean-conversion node or alternate loop-entry semantics.

### C-04 - Support Claims Must Follow the Matrices
Platform and backend promises are now owned by `platform-support-matrix.md` and `backend-compatibility-matrix.md`. Shipping beyond those gates without updating the matrices would be a contract violation.

### Bottom Line
No remaining block on launch. The prosecution position is now to defend the freeze, not reopen it informally.
