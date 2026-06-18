const PRIVATE_BLOCK = /<private>[\s\S]*?<\/private>/gi;

export function stripPrivateContent(content: string): string {
  return content.replace(PRIVATE_BLOCK, "");
}

export function isFullyPrivate(content: string): boolean {
  PRIVATE_BLOCK.lastIndex = 0;
  const hasPrivateBlock = PRIVATE_BLOCK.test(content);
  return hasPrivateBlock && stripPrivateContent(content).trim().length === 0;
}
