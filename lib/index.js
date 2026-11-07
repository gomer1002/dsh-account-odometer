/**
 * Host half of dsh-account-odometer.
 *
 * The feature lives entirely in the browser half (`./client`): it reads the
 * `tokenUsage` Session projection and the account Remote namespace, both of
 * which already exist in the Web composition. This host module therefore only
 * keeps the Loader row valid; it has no services, tools, or configuration.
 *
 * @module dsh-account-odometer
 */

export const name = 'dsh-account-odometer'

/** Mount nothing on the Host. */
export function apply() {}
