import btHexLogo from "@/assets/bt-hex.svg";

export default function AppHeaderLogoBox() {
  return (
    <div className="w-12 h-12 p-0.5 bg-white-500 rounded-lg select-none">
      <img src={btHexLogo} alt="Blade Terminal" className="w-full h-full" />
    </div>
  );
}
