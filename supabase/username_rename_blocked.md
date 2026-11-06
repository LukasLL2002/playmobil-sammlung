# Username rename blocked (API)

GitHub REST `PATCH /user` OpenAPI schema has **no `username` property**.
Sending `-f username=SortivaApp` returns HTTP 200 but **does not change `login`**.
Username changes must be done in the website: https://github.com/settings/admin

Desired: LukasLL2002 → SortivaApp → https://sortivaapp.github.io/
Alternative if preferred later: create org `SortivaApp` + `SortivaApp.github.io` (keeps login LukasLL2002).

Legacy LukasLL2002 redirect account: **not created** (bot email consent pending).
