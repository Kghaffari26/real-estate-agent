"""Listing Prep Advisor: the private, queued worker side (SPEC_LISTING_PREP.md).

Unlike `agents.real_estate`, nothing here publishes: it reads and writes the Desk's
private backend (Supabase, service role, server-side only) and reaches Claude only
through `agents_core.llm`.
"""
