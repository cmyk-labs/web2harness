import mark from "../../../assets/brand/brand-mark.json";

export function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark${small ? " is-small" : ""}`}>
      <svg aria-hidden="true" viewBox={mark.viewBox}>
        <path
          d={mark.path}
          fill="currentColor"
          fillRule="evenodd"
          clipRule="evenodd"
        />
      </svg>
    </span>
  );
}
