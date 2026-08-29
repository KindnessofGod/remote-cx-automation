# All per-country logic is built and live-verified against a fixed 9-country list

Status: accepted

Remote serves 90+ countries; no public data exists on Remote's actual
per-country request volume, so a portfolio project has no real basis to
prioritize by demand. Instead, every country-specific rule (tax-residency
thresholds, totalization/treaty coverage, immigration/visa gates,
notice-period rules) is built and live-verified against a fixed 9-country
list — UK, Ireland, Germany, Poland, India, Philippines, Mexico, Canada,
Portugal — chosen for rule-shape diversity so every branch the architecture
needs gets exercised at least once (a ties-based test with no single
threshold, confirmed EU/EEA totalization coverage, confirmed no-coverage
cases, a real Digital Nomad Visa). Any country outside the list falls
through to escalate-by-default, which is correct behavior, not a gap.

**Considered and rejected:** picking countries by inferred real-world EOR
volume alone. Rejected as insufficient on its own — volume data doesn't
exist publicly, and rule-shape diversity is what actually exercises every
code path, so it was used as the primary selection criterion, with plausible
volume as a secondary signal only.

Full resolution: `00-FOUNDATION.md` §4 invariant 9, GitHub issue #14.
