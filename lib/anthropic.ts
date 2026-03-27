import Anthropic from '@anthropic-ai/sdk';
import { CLAUDE_MODEL } from './constants';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export { CLAUDE_MODEL };

// Never use any model string other than CLAUDE_MODEL.
// Any other model string returns a 404.
