import AppHeaderLogoBox from "@/components/app-header/AppHeaderLogoBox";
import { UserMenu } from "@/features/auth/components/UserMenu";
import TitleBar from "./title-bar/TitleBar";
import MenuBar from "./menu-bar/MenuBar";

export default function ApplicationHeader() {
  return (
    <div className="relative z-30 flex items-center gap-3 px-3 py-1 bg-gray-100 border border-gray-300">
      <div className="shrink-0">
        <AppHeaderLogoBox />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <TitleBar />
        <MenuBar />
      </div>
      <div className="shrink-0">
        <UserMenu />
      </div>
    </div>
  );
}
