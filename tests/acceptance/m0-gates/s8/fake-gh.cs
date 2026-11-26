// A fake GitHub CLI (`gh`) for the acceptance tests of m0-gates S8. It holds fake data only and
// never calls GitHub.
//
// Why a program and not a script: the app starts `gh` without a shell. Node then finds only
// `gh.exe` or `gh.com` on PATH, so a `gh.cmd` script would not run. The fixture compiles this
// file with the C# compiler of the .NET Framework, which is part of Windows.
//
// Each call:
// - writes its arguments to a new file in `calls\` beside the program, so a test can count the calls;
// - prints the content of `answers\<key>.json` beside the program, and exits with 0;
// - exits with 1 when no answer exists for its arguments.
// The key is the arguments joined with spaces. Each character other than an ASCII letter, a digit
// or `-` becomes `_`. Example: `api users/example-user-one` has the key `api_users_example-user-one`.
using System;
using System.IO;
using System.Text;

static class FakeGh
{
    static int Main(string[] args)
    {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        string line = string.Join(" ", args);

        // One file per call: two calls at the same time cannot conflict.
        string calls = Path.Combine(folder, "calls");
        Directory.CreateDirectory(calls);
        File.WriteAllText(Path.Combine(calls, Guid.NewGuid().ToString("N") + ".txt"), line, new UTF8Encoding(false));

        StringBuilder key = new StringBuilder();
        foreach (char c in line) key.Append((c < 128 && char.IsLetterOrDigit(c)) || c == '-' ? c : '_');
        string answer = Path.Combine(folder, "answers", key.ToString() + ".json");
        if (!File.Exists(answer))
        {
            Console.Error.WriteLine("fake gh: no answer for: " + line);
            return 1;
        }
        byte[] bytes = File.ReadAllBytes(answer);
        using (Stream output = Console.OpenStandardOutput()) output.Write(bytes, 0, bytes.Length);
        return 0;
    }
}
