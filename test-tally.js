import { sendToTally } from "./tally.js";

const xml = `
<ENVELOPE>
    <HEADER>
        <VERSION>1</VERSION>
        <TALLYREQUEST>Export</TALLYREQUEST>
        <TYPE>Collection</TYPE>
        <ID>List of Ledgers</ID>
    </HEADER>

    <BODY>
        <DESC>
            <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
        </DESC>
    </BODY>
</ENVELOPE>
`;

try {
    console.log("Connecting to Tally...");

    const response = await sendToTally(xml);

    console.log("Connected successfully!");
    console.log("Staying connected. Press Ctrl+C to stop.");

    process.on("SIGINT", () => {
        console.log("\nDisconnected.");
        process.exit(0);
    });

    setInterval(() => {}, 60_000);

} catch (error) {
    console.error("Tally connection failed:");
    console.error(error.message);
}