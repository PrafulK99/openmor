// Responses for the llms.txt routes. Plain text, so a person can read it in a browser and a model can
// fetch it. The 404 is one fixed body for every missing merchant: it must not hint at what exists.

const TEXT = "text/plain; charset=utf-8";

export function llmsResponse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": TEXT } });
}

export function llmsNotFound(): Response {
  return new Response("Not found\n", { status: 404, headers: { "content-type": TEXT } });
}
