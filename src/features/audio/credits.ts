/** Every audio file and its licence. Mirrors CREDITS.md; CC-BY entries are credited in-game. */
export interface AudioCredit {
  key: string;
  title: string;
  author: string;
  url: string;
  license: string;
}

export const AUDIO_CREDITS: readonly AudioCredit[] = [];
