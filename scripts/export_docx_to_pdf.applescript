on run argv
    if (count of argv) is not 2 then error "Usage: export_docx_to_pdf.applescript <input.docx> <output.pdf>"

    set inputPath to POSIX file (item 1 of argv)
    set outputPath to POSIX file (item 2 of argv)

    tell application "Pages"
        activate
        set openedDoc to open inputPath
        delay 2
        export openedDoc to outputPath as PDF
        close openedDoc saving no
        quit
    end tell
end run
