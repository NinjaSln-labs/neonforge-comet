# Local Baseline Sources

This directory stores immutable local copies of confirmed authoritative benchmark
material and staged candidates. It exists so verification can run offline and so that
published numbers are never silently replaced by locally generated data.

Rules:

- A source becomes canonical only after its normalized entry is recorded in
  `benchmarks/registry.json` with a matching hash.
- The raw source files are kept with publisher, URL, retrieval date, version, method,
  and redistribution notes in the registry.
- Withheld judge keys, private credentials, and private repository contents are never
  committed here.
- Bug Hunt Bench materials are kept for local evaluation reference. The public
  benchmark repository did not include an explicit license file at retrieval time, so
  these files must not be presented as NeonForge-owned benchmark content or
  redistributed as part of a product claim.
