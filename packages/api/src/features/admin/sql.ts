/**
 * Escape LIKE wildcards so a search for "50%" matches literally instead of
 * turning into a wildcard. Postgres uses backslash as the default escape.
 *
 * Shared by the admin services, which all build `ilike` filters from free-text
 * search input.
 */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);
