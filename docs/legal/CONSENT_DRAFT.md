# Seller photo consent: draft for counsel review

**Status: DRAFT, not reviewed.** Written by the build, not by a lawyer. The brokerage's
counsel must review it before the Desk is used with real sellers (STATUS.md lists this
as an owner action). The Desk shows this text when an agent records consent, and it
stores the version with every consent.

- **Current version:** `2026-10b`. This is the only version that permits AI analysis;
  the database enforces that (`processing_consent()`).
- **Superseded:** `2026-10` (P1). It did not disclose the third-party AI provider or
  photo retention. Photos recorded under it can still be shown to the team, but they
  are not analyzed until the seller consents to `2026-10b`.

## The text (version 2026-10b)

> **Consent to photograph and analyze the property**
>
> I agree that my listing agent's brokerage may upload photos of my property to the
> brokerage's private online workspace, to prepare an analysis of what to repair or
> improve before listing. I understand that:
>
> 1. **AI analysis by a third party.** The photos are analyzed by an artificial
>    intelligence model run by a third-party provider (currently Anthropic, PBC), acting
>    for the brokerage. The provider processes the photos only to return the analysis.
>    Under its commercial terms, it does not use them to train its models. It may keep
>    them for a limited period under its own policies, for safety and abuse monitoring.
> 2. **Condition only.** The analysis covers the property's condition and possible
>    repairs and improvements. Photos that show people are skipped. The analysis does
>    not describe occupants, their belongings, or the neighborhood's residents.
> 3. **Storage and retention.** The photos are stored privately with a cloud provider
>    in the United States. Only the brokerage team's members can see them. They are
>    deleted 12 months after upload, or within 30 days after I revoke this consent,
>    whichever comes first. They are deleted sooner if I ask.
> 4. **Revoking.** I can revoke this consent at any time by telling my agent. From that
>    moment, no photo is analyzed, the photos are hidden from the brokerage's workspace,
>    and any analysis based on them is withdrawn.
> 5. **Not an appraisal.** The analysis helps prepare the listing. It is not an
>    appraisal, an inspection, or a guarantee of sale price.

The Desk records who gave consent, how (signed form, email or in person), the date, and
the agent who recorded it.

## What counsel should check

1. **Disclosure of the AI provider.** Should the provider be named, and how should a
   change of provider be handled (a new version and fresh consent, or a notice)?
   Confirm the provider's current terms on training and on retention of API inputs
   (at the time of writing: no training on commercial API data by default, with
   limited retention for trust and safety). Consider whether to request zero data
   retention.
2. **Retention periods.** Are 12 months after upload and 30 days after revocation
   acceptable, and do they match the brokerage's record-keeping duties? The Desk
   enforces both automatically (`expire_photos()`), and managers can delete a
   property's photos at any time.
3. **California law.** CCPA/CPRA notice duties, if the brokerage is a covered business
   (the seller is a consumer; photos of a home may include personal information).
   Notice at collection, and the right to delete, which the Desk supports.
4. **Fair housing.** The analysis is limited to condition and fixes, and it skips photos
   with people (SPEC_LISTING_PREP.md §3). Is the description in point 2 accurate and
   enough?
5. **Form of consent.** Is a recorded "in person" consent enough, or should it always be
   signed or emailed? Should the text be attached to the listing agreement?
6. **Other people's images.** Tenants or other occupants who are not the seller. Should
   the seller confirm they have authority to consent for the whole property?
7. **The earlier version (2026-10).** Should consents recorded under it be treated as
   invalid for display as well (today they only block analysis)?
