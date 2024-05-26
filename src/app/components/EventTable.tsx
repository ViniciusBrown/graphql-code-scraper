import { Box, Table, Text } from 'gestalt';
import { EventType } from '../server/utils/data_dependency_tracker';


type PropsType = {
	trackedVars: EventType[][]
}
export default function EventsTable({trackedVars}: PropsType) {
	const columnNames = [
    'type',
    'from_var',
    'to_var',
    'from_scope',
    'to_scope',
		'complete_from_var',
  ] as const

  return (
    <>
      <Box display='flex' justifyContent='center' width='100%'>
        <h2>Events List</h2>
      </Box>
      <Box
      height="100%"
      display="flex"
      justifyContent="start"
      alignItems="start"
    >
      <Table accessibilityLabel="Sortable header cells">
        <Table.Header>
          <Table.Row>
            {columnNames.map(name => 
                <Table.HeaderCell key={name}>
                    <Text weight="bold">{name}</Text>
                </Table.HeaderCell>
            )}
          </Table.Row>
        </Table.Header>
				<Table.Body>
					{trackedVars.map((eventBus) => eventBus.map(event => 
						<Table.Row key={event.id}>
							{columnNames.map(val => 
								<Table.Cell key={val}>
									<Text>{event[val] && typeof event[val] === 'string' ? event[val] : (event[val] && Array.isArray(event[val]) ? event[val]?.join('.') : '')}</Text>
								</Table.Cell>
							)}
						</Table.Row>
					))}
				</Table.Body>


      </Table>
    </Box>
    </>

  );
}