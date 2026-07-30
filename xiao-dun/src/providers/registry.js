/**
 * Provider registry used by the capability layer.
 *
 * Providers advertise the supported image-generation capability. The registry owns selection and invocation so callers
 * do not depend on a concrete provider implementation.
 */

const providers = []
const SUPPORTED_CAPABILITIES = ['image']

export function registerProvider(provider) {
  providers.push(provider)
  console.log(`[provider] registered ${provider.name}`)
}

export function replaceProvider(provider) {
  const index = providers.findIndex((candidate) => candidate.name === provider.name)
  if (index >= 0) {
    providers.splice(index, 1, provider)
    console.log(`[provider] replaced ${provider.name}`)
    return
  }
  providers.push(provider)
  console.log(`[provider] registered ${provider.name}`)
}

export function getProvider(capability) {
  const provider = providers.find((candidate) => candidate.canDo(capability))
  if (!provider) {
    throw new Error(`No provider supports capability: "${capability}"`)
  }
  return provider
}

export async function callCapability(capability, params) {
  const provider = getProvider(capability)
  return provider.call(capability, params)
}

export function getAllQuotaStatus() {
  const result = {}
  for (const provider of providers) {
    result[provider.name] = provider.getQuotaStatus()
  }
  return result
}

export function listCapabilities() {
  const capabilities = new Set()
  for (const provider of providers) {
    for (const capability of SUPPORTED_CAPABILITIES) {
      if (provider.canDo(capability)) capabilities.add(capability)
    }
  }
  return [...capabilities]
}
