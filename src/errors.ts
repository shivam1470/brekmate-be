export class Fault extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function requireThat(
  value: unknown,
  code: string,
  status = 409,
): asserts value {
  if (!value) throw new Fault(status, code);
}
