# Incident

What to do when something is broken in production. Short on purpose: read it
under stress. This file is a template until the two names below are filled in.

## Who

- **Receives alerts:** _name, and where the alert arrives (e-mail, phone, chat)_
- **Stands in when they are away:** _name, and how they get access_
- **Users report problems at:** _a channel named in the app or its docs_

A one-person project still fills in all three. "Nobody" is an answer worth
seeing written down.

## First 15 minutes

1. Confirm it: open `/api/health` and the main user flow. Check the error tracker and Vercel → Logs.
2. Decide: is a recent deploy the likely cause? Roll back first, investigate later (`rollback.md`, Code).
3. Data written wrong or deleted? Stop the writes (pause the job, disable the route), then `rollback.md`, Data.
4. Tell the users who are affected: what is broken, what still works, when you will write next.
5. Write a line in the log below with the time you started.

## After

Within a week: what happened, why, how it was found, what changes so it does
not happen again. Link the fix. One paragraph is enough; no blame.

## Log

| Started | Ended | What broke | Cause | Follow-up |
|---|---|---|---|---|
