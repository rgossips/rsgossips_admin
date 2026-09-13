// RGossipsWidget.exe - hosts widget/RGossipsWidget.ps1 in-process.
//
// Why a host and not a "powershell.exe -ExecutionPolicy Bypass -File ..."
// launcher: spawning a hidden PowerShell with Bypass is a classic malware
// pattern that antivirus flags. Running the embedded script through the
// System.Management.Automation API keeps it to one ordinary process with its
// own name and icon, no console window, and no files extracted to disk.
//
// C# 5 only (built with the csc.exe that ships in .NET Framework 4.x - see
// Build-WidgetExe.ps1): no string interpolation, no nameof, no => members.

using System;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Windows.Forms;

[assembly: AssemblyTitle("RGossips Admin Widget")]
[assembly: AssemblyDescription("Desktop stats widget for the RGossips admin portal")]
[assembly: AssemblyCompany("RGossips")]
[assembly: AssemblyProduct("RGossips Admin Widget")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Program
{
    [STAThread]
    static int Main()
    {
        string script;
        using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("RGossipsWidget.ps1"))
        {
            if (s == null) { Fail("The widget script is missing from this build."); return 2; }
            using (StreamReader r = new StreamReader(s, Encoding.UTF8)) { script = r.ReadToEnd(); }
        }

        // No script file exists at runtime, so tell the script where "home" is
        // (per-user settings folder) and where the exe lives (for the
        // Start-with-Windows shortcut).
        string home = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RGossipsAdminWidget");
        Directory.CreateDirectory(home);
        Environment.SetEnvironmentVariable("RGW_SCRIPT_DIR", home);
        Environment.SetEnvironmentVariable("RGW_EXE_PATH", Assembly.GetExecutingAssembly().Location);

        try
        {
            InitialSessionState iss = InitialSessionState.CreateDefault();
            iss.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.Bypass;

            using (Runspace rs = RunspaceFactory.CreateRunspace(iss))
            {
                // WPF needs a single-threaded apartment, and the window must be
                // created on this (the STA main) thread.
                rs.ApartmentState = ApartmentState.STA;
                rs.ThreadOptions = PSThreadOptions.UseCurrentThread;
                rs.Open();

                using (PowerShell ps = PowerShell.Create())
                {
                    ps.Runspace = rs;
                    ps.AddScript(script);
                    ps.Invoke();
                }
            }
        }
        catch (Exception ex)
        {
            Exception root = ex;
            while (root.InnerException != null) { root = root.InnerException; }
            Fail("The widget stopped unexpectedly:\n\n" + root.Message);
            return 1;
        }
        return 0;
    }

    static void Fail(string message)
    {
        MessageBox.Show(message, "RGossips Admin Widget", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
