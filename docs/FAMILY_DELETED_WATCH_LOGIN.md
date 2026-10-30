# Family login after watch deletion

A family account remains usable after its final senior/watch is deleted. Once
the account is verified, Home shows **No watches linked**, and Profile, logout,
and Manage watches remain available. Another approved watch is selected when
one remains. An unsuccessful watch-list request is shown as a retryable error,
not as proof that the account has no watches.

The startup regression was reproduced using the real family app with synthetic
auth notifications and a cached deleted Watch ID. Repeated SIGNED_IN events for
the same user and exact token kept invalidating the in-flight account check;
the account remained on the splash screen after hundreds of checks.

The session hook now ignores duplicate SIGNED_IN/INITIAL_SESSION notifications
for the same user and exact token. A different token/user, MFA, recovery, token
refresh, or user-update event still triggers verification. Protected views remain
gated by the existing server permission, MFA, and privacy-acceptance checks.

Read-only account checks have a 12-second deadline; watch-list reads have a
10-second deadline. Stalled requests end with retry controls. Old responses
cannot overwrite newer account/watch state. Removed watch selections, GPS cache,
alerts, and reminder state are discarded after the authorized list is loaded.
An in-flight alert read is invalidated when the linked-watch membership changes.

No SQL migration, account changes, or real deletions are needed for this fix.
Validation covers the repeated-session reproduction, absent/remaining watches,
cache cleanup, stalled account/watch reads and retry, new-session MFA, live
deletion of synthetic watches, and production builds. Tests use synthetic data.
