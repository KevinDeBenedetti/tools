import type { RetrievalCase } from "./retrieval";

// Default retrieval suite.
//
// Every negative deliberately shares vocabulary with the query — "password"
// appears in all four documents of the first case, "refund" in all four of the
// second. Lexical overlap therefore carries no signal, and a model can only
// rank the positive first by encoding what the query actually asks for. That is
// what separates a usable embedding model from one that behaves like a bag of
// words, and it is why an easy suite of unrelated documents would tell you
// nothing: every model scores 100% on those.

export const DEFAULT_RETRIEVAL_CASES: RetrievalCase[] = [
  {
    id: "password-reset",
    negatives: [
      "Passwords must be at least 12 characters and include a number.",
      "You can change your display name and avatar in profile settings.",
      "Contact billing support to reset your subscription to the free plan.",
    ],
    positive: "Click 'Forgot password' on the sign-in page and we will email you a reset link.",
    query: "How do I reset my password?",
  },
  {
    id: "refund-window",
    negatives: [
      "Refunds are issued to the original payment method within 10 business days.",
      "We refund shipping costs only when the parcel arrives damaged.",
      "Your subscription renews automatically unless cancelled before the renewal date.",
    ],
    positive: "You may request a refund within 30 days of purchase.",
    query: "How long do I have to ask for a refund?",
  },
  {
    id: "python-dedupe",
    negatives: [
      "Use sorted(xs) to return a new list with the elements in ascending order.",
      "A Python set is an unordered collection that cannot contain duplicates.",
      "list.remove(x) deletes the first occurrence of x and raises ValueError if absent.",
    ],
    positive:
      "Call list(dict.fromkeys(xs)) to drop duplicates while preserving the original order.",
    query: "How do I remove duplicates from a Python list but keep the order?",
  },
  {
    id: "git-undo-commit",
    negatives: [
      "git revert creates a new commit that undoes the changes of an earlier one.",
      "git reset --hard discards every uncommitted change in the working tree.",
      "git commit --amend rewrites the message of the most recent commit.",
    ],
    positive: "git reset --soft HEAD~1 undoes the last commit while leaving its changes staged.",
    query: "How do I undo my last commit but keep the changes staged?",
  },
  {
    id: "docker-image-vs-container",
    negatives: [
      "docker ps lists the containers that are currently running.",
      "A Dockerfile is the recipe from which an image is built.",
      "Use docker volume to persist data beyond the lifetime of a container.",
    ],
    positive:
      "An image is a read-only template; a container is a running instance created from it.",
    query: "What is the difference between a Docker image and a container?",
  },
  {
    id: "lease-notice",
    negatives: [
      "The security deposit is returned within one month of the final inspection.",
      "Rent is due on the first day of each month and is late after the fifth.",
      "The landlord must give 24 hours notice before entering the property.",
    ],
    positive: "Tenants must give the landlord two months written notice before leaving.",
    query: "How much notice do I need to give before moving out?",
  },
  {
    id: "dehydration-signs",
    negatives: [
      "Adults should drink roughly two litres of water per day in a temperate climate.",
      "Sports drinks replace the electrolytes lost through heavy sweating.",
      "Dehydration is a common complication of prolonged fever.",
    ],
    positive: "Dark urine, a dry mouth, dizziness and unusual tiredness signal dehydration.",
    query: "What are the symptoms of dehydration?",
  },
  {
    id: "photosynthesis-output",
    negatives: [
      "Photosynthesis takes place in the chloroplasts of plant cells.",
      "Chlorophyll gives leaves their green colour by reflecting green light.",
      "Respiration consumes oxygen and releases carbon dioxide.",
    ],
    positive: "Photosynthesis converts carbon dioxide and water into glucose and oxygen.",
    query: "What does photosynthesis produce?",
  },
  {
    id: "store-hours",
    negatives: [
      "Our warehouse dispatches orders every weekday afternoon.",
      "The shop is closed on public holidays and on Easter Sunday.",
      "Click and collect orders can be picked up from the side entrance.",
    ],
    positive: "We are open from 9am to 6pm Monday through Saturday.",
    query: "What time does the store close?",
  },
  {
    id: "index-slow-query",
    negatives: [
      "A primary key automatically creates a unique index on that column.",
      "Indexes make writes slower because every insert must update them too.",
      "VACUUM reclaims storage occupied by rows that have been deleted.",
    ],
    positive:
      "Add an index on the columns used in the WHERE clause so the planner can avoid a sequential scan.",
    query: "My database query is slow, how do I speed it up?",
  },
];
