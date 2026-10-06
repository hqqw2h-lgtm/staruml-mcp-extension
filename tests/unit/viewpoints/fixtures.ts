/** A small model with a view of every viewpoint, for the viewpoint tests. */
export const KIOSK = {
  system: "Kiosk",
  contexts: [
    { id: "sales", name: "Sales", dependsOn: ["stock"] },
    { id: "stock", name: "Stock" },
  ],
  classes: [
    { name: "Order", context: "sales", operations: ["+place(): void"] },
    { name: "Line", context: "sales" },
    { name: "Item", context: "stock" },
    { name: "Shelf", context: "stock" },
  ],
  relationships: [
    { from: "Order", to: "Line", type: "owns" },
    { from: "Line", to: "Item", type: "knows" },
    { from: "Shelf", to: "Item", type: "has" },
  ],
  actors: ["Clerk", "Buyer"],
  useCases: [
    { name: "Sell goods", actors: ["Clerk"] },
    { name: "Buy goods", actors: ["Buyer"], includes: ["Sell goods"] },
  ],
  collaborations: [
    {
      name: "Checkout",
      participants: [{ name: "Clerk", kind: "actor" }, "Order", "Line"],
      messages: [
        ["Clerk", "Order", "place()"],
        ["Order", "Line", "add()"],
      ],
    },
    { name: "Restock", messages: [["Shelf", "Item", "refill()"]] },
  ],
  lifecycles: [
    {
      name: "Order life",
      subject: "Order",
      states: [{ id: "i", type: "initial" }, "Open", "Paid"],
      transitions: [
        { from: "i", to: "Open" },
        { from: "Open", to: "Paid", trigger: "pay" },
      ],
    },
    {
      name: "Shift",
      states: ["On", "Off"],
      transitions: [{ from: "On", to: "Off" }],
    },
  ],
  activities: [
    {
      name: "Close day",
      nodes: [
        { id: "s", type: "initial" },
        { name: "Count cash" },
        { id: "e", type: "final" },
      ],
      flows: [
        ["s", "Count cash"],
        ["Count cash", "e"],
      ],
    },
  ],
  erd: {
    entities: [
      { name: "orders", columns: ["id int PK"] },
      { name: "lines", columns: ["id int PK", "order_id int FK"] },
    ],
    relationships: [["orders", "lines", "1", "0..*"]],
  },
  components: {
    name: "Kiosk containers",
    elements: [
      { id: "buyer", name: "Buyer", type: "person" },
      { id: "app", name: "Till app", type: "container", technology: "TS" },
      { id: "db", name: "Till DB", type: "container", kind: "database" },
      { id: "pay", name: "Payments", type: "system", external: true },
      { id: "cart", name: "Cart", type: "component" },
    ],
    relations: [
      ["buyer", "app", "Buys", "HTTPS"],
      ["buyer", "db", "Looks up", "SQL"],
      ["app", "db", "Reads", "SQL"],
      ["app", "pay", "Charges", "REST"],
      { from: "db", to: "pay", label: "Settles" },
      ["cart", "app", "Lives in"],
    ],
  },
  deployments: [
    {
      name: "Shop floor",
      nodes: [
        { name: "Till", kind: "device", contains: ["till.js"] },
        { name: "Server" },
      ],
      links: [["Till", "Server", "LAN"]],
    },
  ],
  features: {
    name: "Kiosk features",
    children: [{ name: "Selling" }, { name: "Stock" }],
  },
};
