export function readFormString(formData: FormData, name: string): string {
  const value: FormDataEntryValue | null = formData.get(name);
  return typeof value === 'string' ? value : '';
}
