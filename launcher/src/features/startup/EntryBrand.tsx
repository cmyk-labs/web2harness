import { BrandMark } from "../../components/BrandMark";
import "./entry.css";

export function EntryBrand({ version, devProfile = false }: { version?: string; devProfile?: boolean }) {
  return <div className="entry-brand">
    <BrandMark />
    <strong>Web2Harness</strong>
    {version && <span className="brand-version">v{version}</span>}
    {devProfile && <span className="dev-profile-badge">DEV</span>}
  </div>;
}
