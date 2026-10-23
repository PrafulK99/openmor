// /llms.txt: a plain-text index of the network for LLMs (https://llmstxt.org/). Built from our own
// database through a cached read, so it is prerendered and never calls a payment provider.
import { cachedNetworkLlmsTxt } from "../public-data";
import { llmsResponse } from "../llms-response";

export async function GET(): Promise<Response> {
  return llmsResponse(await cachedNetworkLlmsTxt());
}
