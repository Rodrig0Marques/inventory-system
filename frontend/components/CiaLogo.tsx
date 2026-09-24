export function CiaLogo({
  size = 44,
}: {
  size?: number;
}) {
  return (
    <div
      className="cia-logo"
      style={{
        width: size,
        height: size,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient
            id="ciaGradient"
            x1="8"
            y1="8"
            x2="40"
            y2="40"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#5EA2FF" />
            <stop offset="1" stopColor="#635BFF" />
          </linearGradient>
        </defs>

        <path
          d="M35.5 13.2C32.4 10.5 28.4 9 24 9C15.7 9 9 15.7 9 24C9 32.3 15.7 39 24 39C28.5 39 32.5 37.1 35.3 34.1"
          stroke="url(#ciaGradient)"
          strokeWidth="5"
          strokeLinecap="round"
        />

        <path
          d="M32.4 18.1C30.3 16.1 27.4 15 24.3 15C19.1 15 15 19 15 24C15 29 19.1 33 24.3 33C27.5 33 30.3 31.8 32.4 29.8"
          stroke="rgba(255,255,255,.72)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />

        <circle
          cx="35.5"
          cy="24"
          r="2.4"
          fill="#67E8F9"
        />
      </svg>
    </div>
  );
}