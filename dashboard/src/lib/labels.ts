/** Display labels for enum values in the contract. */
export function triggerText(kind: 'new_major_flag' | 'top_mover'): string {
  return kind === 'new_major_flag' ? 'New major flag' : 'Top mover';
}
