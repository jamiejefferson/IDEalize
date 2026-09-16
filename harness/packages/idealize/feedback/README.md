# @idealize/feedback

Feedback submission and the announcements feed, proxied to a Supabase project the composition names. No project URL or key ships in the code (JJ, 16 Sep 2026: "no keys or platform accesses should be shipped with the product"): `endpoint` and `publishableKey` come from the plugin config, else from `IDEALIZE_FEEDBACK_ENDPOINT` and `IDEALIZE_FEEDBACK_KEY` in the host's environment. The key is the project's publishable key, whose row-level security must allow only inserts on `idealize_feedback` and reads on `idealize_announcements`. Without both values a submission is still kept in the local backup file and the submit route answers 503 with `backedUpLocally: true`, and the announcements route answers an empty list.

## Routes (loopback; the submit route needs `x-idealize-auth: 1`)

- `POST /idealize/feedback/submit` `{ text, feedbackType? }` → inserts a row into `idealize_feedback` stamped with `app_version` and the host OS version, and appends the same text to `<DSH_HOME>/idealize-feedback-backup.md` whatever the network outcome, so a submission made offline is not lost.
- `GET /idealize/announcements` → the newest active row of `idealize_announcements`, verbatim. The client owns version gating and dismissal.

## Configuration (`idealize-feedback` row)

| Field | Default | Meaning |
|---|---|---|
| `appVersion` | `1.0.0-dev` | Stamped into feedback rows as `app_version`. |
| `endpoint` | none | The Supabase REST base URL, `https://<project>.supabase.co/rest/v1`; `IDEALIZE_FEEDBACK_ENDPOINT` when empty. |
| `publishableKey` | none | The project's publishable key; `IDEALIZE_FEEDBACK_KEY` when empty. |

## Model Experience

None, as the package forwards user feedback and announcement rows between the browser and Supabase and touches no model request.

#### KV Cache effect

Independent: nothing here reaches a model request, so no prefix changes and no reuse is invalidated.

## Known Limitations and Deferred Work

- **One upstream per composition.** The endpoint and key are read from the config or the environment at each request; a build ships with none, so feedback stays local until the environment names a project.
- **`appVersion` is a composition default, not the packaged app's real version.** The desktop shell must set it in its profile patch, or every row reports `1.0.0-dev`.
