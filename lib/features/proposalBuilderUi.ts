/**
 * Proposal Builder UI gate
 *
 * Set to `false` to hide all proposal-builder entry points (Quote Log edit/download,
 * signature badges, Personalization → Proposal template) while leaving APIs, DB
 * tables, and `components/proposal-template/**` intact.
 *
 * To restore the feature: set `PROPOSAL_BUILDER_UI_ENABLED` to `true` and ship.
 * Introduced on branch `hide-proposal-builder` — revert that commit if preferred.
 */
export const PROPOSAL_BUILDER_UI_ENABLED = false;
