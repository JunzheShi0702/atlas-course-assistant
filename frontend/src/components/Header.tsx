import atlasLogo from "@/lib/logo.png";

import HeaderActions from "@/components/HeaderActions";

export default function Header() {
  return (
    <header className="header-root">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <img
          src={atlasLogo}
          alt="Atlas logo"
          className="h-9 w-auto shrink-0 object-contain"
        />

        <HeaderActions />
      </div>
    </header>
  );
}