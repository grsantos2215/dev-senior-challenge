import ky from "ky"

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

const baseUrl = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/$/, "")

export const api = ky.create({
  prefixUrl: `${baseUrl}/`,
  timeout: 15_000,
  retry: 0,
  hooks: {
    afterResponse: [async (_request, _options, response) => {
      if (!response.ok) {
        let message = `A API respondeu com erro (${response.status}).`
        try {
          const body = await response.clone().json() as { message?: string | string[] }
          if (Array.isArray(body.message)) message = body.message.join(" ")
          else if (body.message) message = body.message
        } catch {
          // Keep the safe generic message when the API returns a non-JSON body.
        }
        throw new ApiError(response.status, message)
      }
      return response
    }],
  },
})
