# RFCs

Home of the RFC/ADR process required by §95 of the specification and by the
implementation plan's governance rule (`docs/plans/IMPLEMENTATION_PLAN.md` §2): any change
that is architecturally significant — or any work packet that fixes a **new cross-package
API surface not already pinned by the spec or the plan's §3.5 design decisions** — needs an
RFC accepted by the owner before implementation.

Process:

1. Copy `0000-template.md` to `NNNN-short-title.md` (next free number).
2. Fill in every section (§95 lists the required content).
3. Mark the header **proposed** when it is ready for the owner. The owner accepts, rejects,
   or requests changes; the decision and date are recorded in the RFC header and echoed in
   `MEMORY.md`. An accepted RFC's decision text is never rewritten: later drift is recorded
   in a dated *Post-acceptance corrections* section at its foot.
4. Accepted RFCs that amend the specification also get a row in the spec's amendments
   table; the spec's §-numbering rules apply (1–120 frozen, letter suffixes for new
   sections).

Small implementation choices inside one package do not need an RFC — the plan's packet
format and the spec pin those. When in doubt, ask in the RFC's Context section whether it
crosses a package boundary; if yes, it needs one.
