---
stage: 1
stale_days: 7
drill_max_days: 90
---
# Human gates

Things only a human can do: secrets, DNS, vendor accounts, passphrases, a
rehearsed restore. The agent reads open lines aloud at the start of every
session until the list is empty. A line older than `stale_days` or past its
`due:` turns gate 4 STALE.

