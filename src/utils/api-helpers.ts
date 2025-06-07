
/**
 * A wrapper around fetch that implements an exponential backoff retry strategy.
 * Conforms to the error handling policy in the technical reference (Rule 2.2).
 */
export async function fetchWithRetry(url: string, maxRetries = 5): Promise<Response> {
  const retryableStatusCodes = [429, 500, 502, 503, 504];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`[API] Attempt ${attempt + 1}/${maxRetries} for: ${url}`);
      const response = await fetch(url);

      // If the request was successful, return the response immediately.
      if (response.ok) {
        console.log(`[API] Success on attempt ${attempt + 1}: Status ${response.status}`);
        return response;
      }

      // A 404 is a valid "not found" response, not a server error.
      // The calling service will handle this by returning empty/null data.
      if (response.status === 404) {
        console.warn(`[API] Resource not found (404), continuing gracefully: ${url}`);
        return response;
      }

      // If the error is not in our retryable list, it's a fatal error.
      if (!retryableStatusCodes.includes(response.status)) {
        console.error(`[API] Fatal error: Status ${response.status} for ${url}`);
        throw new Error(`Fatal API Error: Status ${response.status} for ${url}`);
      }
      
      // If we are on the last attempt, throw the error to halt the process.
      if (attempt === maxRetries - 1) {
        console.error(`[API] Failed after ${maxRetries} attempts with status ${response.status}`);
        throw new Error(`API continued to fail after ${maxRetries} attempts with status ${response.status}`);
      }

      // Calculate delay for exponential backoff: 1s, 2s, 4s, ... + jitter
      const delay = Math.pow(2, attempt) * 1000 + (Math.random() * 1000);
      console.log(`[API] Retryable error ${response.status}. Retrying in ${delay.toFixed(0)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));

    } catch (error) {
      // This catches network errors (e.g., DNS failure, no internet)
      console.error(`[API] Network error during fetch attempt ${attempt + 1}:`, error);
      if (attempt === maxRetries - 1) {
        throw error; // Re-throw the final error
      }
      const delay = Math.pow(2, attempt) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  // This line should theoretically be unreachable, but it satisfies TypeScript.
  throw new Error(`Failed to fetch from ${url} after ${maxRetries} attempts.`);
}
