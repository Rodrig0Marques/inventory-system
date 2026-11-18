export function CiaLogo({ size = 44 }: { size?: number }) {
  return (
    <span className="cia-logo cia-monogram" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M46 12H30C18.95 12 10 20.95 10 32s8.95 20 20 20h16V41H30a9 9 0 0 1 0-18h16V12Z" fill="currentColor" />
        <path className="cia-monogram-spark" d="m47 26 6 6-6 6-6-6 6-6Z" fill="currentColor" />
      </svg>
    </span>
  );
}
