# UMLDiagram — Type Reference

Source: https://files.staruml.io/api-docs/2.0.0/api/modules/uml/UMLDiagram.html

Exhaustive list of UML diagram types, model element types, and view types used by `Factory.createDiagram` / `Factory.createModelAndView`.

## Diagram types (`UMLXxxDiagram`)

Pass to `app.factory.createDiagram(typeName, parent, options)`:

- `UMLActivityDiagram`
- `UMLClassDiagram`
- `UMLCommunicationDiagram`
- `UMLComponentDiagram`
- `UMLCompositeStructureDiagram`
- `UMLDeploymentDiagram`
- `UMLObjectDiagram`
- `UMLPackageDiagram`
- `UMLProfileDiagram`
- `UMLSequenceDiagram`
- `UMLStatechartDiagram`
- `UMLUseCaseDiagram`
- `UMLDiagram` (abstract base — don't use directly)

## Model/View types per diagram

Factory pairs `UMLXxx` (model) with `UMLXxxView` (view). Pass the **model** type name to `createModelAndView(typeName, parent, diagram, options)`.

### Use Case (UMLUseCaseDiagram)

Model types: `UMLActor`, `UMLUseCase`, `UMLSubsystem`, `UMLInclude`, `UMLExtend`, `UMLAssociation`
View types: `UMLActorView`, `UMLUseCaseView`, `UMLSubsystemView`, `UMLIncludeView`, `UMLExtendView`, `UMLAssociationView`

### Activity (UMLActivityDiagram)

Model types: `UMLActivity`, `UMLAction`, `UMLInitialNode`, `UMLActivityFinalNode` (aka `UMLFinalNode`), `UMLFlowFinalNode`, `UMLDecisionNode`, `UMLMergeNode`, `UMLForkNode`, `UMLJoinNode`, `UMLObjectNode`, `UMLInputPin`, `UMLOutputPin`, `UMLControlFlow`, `UMLObjectFlow`

### Sequence (UMLSequenceDiagram)

Model types: `UMLLifeline`, `UMLMessage` (model) / `UMLSeqMessageView` (view), `UMLActivation`, `UMLContinuation`, `UMLCombinedFragment`, `UMLGate`, `UMLInteractionOperand`

### Class (UMLClassDiagram)

Model types: `UMLClass`, `UMLInterface`, `UMLDataType`, `UMLEnumeration`, `UMLPrimitiveType`, `UMLAttribute`, `UMLOperation`, `UMLGeneralization`, `UMLAssociation`, `UMLDependency`, `UMLInterfaceRealization`, `UMLPort`

### Component (UMLComponentDiagram)

Model types: `UMLComponent`, `UMLComponentInstance`, `UMLArtifact`, `UMLArtifactInstance`, `UMLComponentRealization`, `UMLDependency`, `UMLPort`, `UMLConnector`

### Deployment (UMLDeploymentDiagram)

Model types: `UMLNode`, `UMLNodeInstance`, `UMLDeployment`, `UMLComponentInstance`, `UMLCommunicationPath`, `UMLDependency`

### State Machine (UMLStatechartDiagram)

Model types: `UMLState`, `UMLPseudostate`, `UMLFinalState`, `UMLTransition`, `UMLRegion`

### Object (UMLObjectDiagram)

Model types: `UMLObject`, `UMLSlot`, `UMLLink`

### Package (UMLPackageDiagram)

Model types: `UMLPackage`, `UMLSubsystem`, `UMLModel`, `UMLContainment`

### Communication (UMLCommunicationDiagram)

Model types: `UMLLifeline`, `UMLCommMessage`, `UMLCommunicationPath`

### Composite Structure (UMLCompositeStructureDiagram)

Model types: `UMLClass`, `UMLPart`, `UMLPort`, `UMLCollaboration`, `UMLConnector`

### Profile (UMLProfileDiagram)

Model types: `UMLProfile`, `UMLStereotype`, `UMLMetaClass`

## Relationships (edges)

Pass to `createModelAndView` when creating edge, or use our `/create_edge_with_view` endpoint:

- `UMLAssociation` — class, use case
- `UMLGeneralization` — class inheritance
- `UMLDependency` — cross-diagram
- `UMLInterfaceRealization` — class implements interface
- `UMLComponentRealization` — component realizes interface
- `UMLControlFlow` — activity
- `UMLObjectFlow` — activity with data
- `UMLMessage` — sequence message (model); view = `UMLSeqMessageView`
- `UMLCommMessage` — communication diagram
- `UMLInclude` — use case «include»
- `UMLExtend` — use case «extend»
- `UMLTransition` — state transition
- `UMLLink` — object diagram
- `UMLConnector` — composite structure
- `UMLContainment` — package containment

## Common model properties

- `name` — element label
- `visibility` — `'public' | 'protected' | 'private' | 'package'`
- `stereotype` — applied UML stereotype
- `documentation` — notes text
- `attributes`, `operations` (UMLClass)
- `end1`, `end2` (UMLAssociation — the two association ends)
- `source`, `target` (UMLTransition, UMLControlFlow)
- `signature`, `messageSort` (UMLMessage)
- `ownedElements` — children collection
